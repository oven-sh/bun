#!/usr/bin/env python3
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import unittest

WINDOWS = sys.platform.startswith('win')
MACOS = sys.platform == 'darwin'
MACOS_ARM64 = MACOS and platform.machine() == 'arm64'

emconfig = os.path.abspath('.emscripten')
assert os.path.exists(emconfig)

upstream_emcc = os.path.join('upstream', 'emscripten', 'emcc')
emsdk = './emsdk'
if WINDOWS:
  upstream_emcc += '.bat'
  emsdk = 'emsdk.bat'
else:
  emsdk = './emsdk'

# Utilities


def listify(x):
  if type(x) in {list, tuple}:
    return x
  return [x]


def check_call(cmd, **args):
  if type(cmd) is not list:
    cmd = cmd.split()
  print('running: %s' % cmd)
  args['universal_newlines'] = True
  subprocess.check_call(cmd, **args)


def checked_call_with_output(cmd, expected=None, unexpected=None, stderr=None, env=None):
  cmd = cmd.split(' ')
  print('running: %s' % cmd)
  try:
    stdout = subprocess.check_output(cmd, stderr=stderr, universal_newlines=True, env=env)
  except subprocess.CalledProcessError as e:
    print(e.stderr)
    print(e.stdout)
    raise e

  if expected:
    for x in listify(expected):
      assert x in stdout, 'expected output missing: ' + stdout + '\n[[[' + x + ']]]'
  if unexpected:
    for x in listify(unexpected):
      assert x not in stdout, 'unexpected output present: ' + stdout + '\n[[[' + x + ']]]'


def failing_call_with_output(cmd, expected, env=None):
  proc = subprocess.Popen(cmd.split(' '), stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, env=env)
  stdout, stderr = proc.communicate()
  if WINDOWS:
    print('warning: skipping part of failing_call_with_output() due to error codes not being propagated (see #592)')
  else:
    assert proc.returncode, 'call must have failed: ' + str([stdout, '\n========\n', stderr])
  assert expected in stdout or expected in stderr, 'call did not have the expected output: %s: %s' % (expected, str([stdout, '\n========\n', stderr]))


def hack_emsdk(marker, replacement):
  with open('emsdk.py') as f:
    src = f.read()
  assert marker in src
  src = src.replace(marker, replacement)
  name = '__test_emsdk'
  with open(name, 'w') as f:
    f.write(src)
  return name


# Set up

TAGS = json.loads(open('emscripten-releases-tags.json').read())

# Tests


def do_lib_building(emcc):
  cache_building_messages = ['generating system library: ']

  def do_build(args, is_expected=None):
    unexpected = None
    expected = None
    if is_expected is True:
      expected = cache_building_messages
    elif is_expected is False:
      unexpected = cache_building_messages
    checked_call_with_output(emcc + ' hello_world.c' + args,
                             expected=expected,
                             unexpected=unexpected,
                             stderr=subprocess.STDOUT)

  # The emsdk ships all system libraries so we don't expect to see any
  # cache population unless we explicly --clear-cache.
  do_build('', is_expected=False)
  check_call(emcc + ' --clear-cache')
  do_build(' -O2', is_expected=True)
  # Do another build at -O0.  In nwers SDK versions this generates
  # different libs, but not in older ones so don't assert here.
  do_build('')
  # Now verify that libs are *not* build
  do_build(' -s WASM=0', is_expected=False)
  do_build(' -O2 -s WASM=0', is_expected=False)


def run_emsdk(cmd):
  if type(cmd) is not list:
    cmd = cmd.split()
  check_call([emsdk] + cmd)


class Emsdk(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    with open('hello_world.c', 'w') as f:
      f.write('''\
#include <stdio.h>

int main() {
   printf("Hello, world!\\n");
   return 0;
}
''')

  def setUp(self):
    run_emsdk('install latest')
    run_emsdk('activate latest')

  def test_unknown_arch(self):
    env = os.environ.copy()
    env['EMSDK_ARCH'] = 'mips'
    failing_call_with_output(emsdk + ' install latest',
                             expected='unknown machine architecture: mips',
                             env=env)

  def test_wrong_bitness(self):
    env = os.environ.copy()
    env['EMSDK_ARCH'] = 'x86'
    failing_call_with_output(emsdk + ' install sdk-latest-64bit',
                             expected='is only provided for 64-bit OSe',
                             env=env)

  def test_already_installed(self):
    # Test we don't re-download unnecessarily
    checked_call_with_output(emsdk + ' install latest', expected='already installed', unexpected='Downloading:')

  def test_list(self):
    # Test we report installed tools properly. The latest version should be
    # installed, but not some random old one.
    checked_call_with_output(emsdk + ' list', expected=TAGS['aliases']['latest'] + '    INSTALLED', unexpected='1.39.15    INSTALLED:')

  def test_config_contents(self):
    print('test .emscripten contents')
    with open(emconfig) as f:
      config = f.read()
    assert 'upstream' in config

  def test_lib_building(self):
    print('building proper system libraries')
    do_lib_building(upstream_emcc)

  def test_redownload(self):
    print('go back to using upstream')
    run_emsdk('activate latest')

    # Test the normal tools like node don't re-download on re-install
    print('another install must re-download')
    checked_call_with_output(emsdk + ' uninstall node-22.16.0-64bit')
    checked_call_with_output(emsdk + ' install node-22.16.0-64bit', expected='Downloading:', unexpected='already installed')
    checked_call_with_output(emsdk + ' install node-22.16.0-64bit', unexpected='Downloading:', expected='already installed')

  def test_tot_upstream(self):
    print('test update-tags')
    run_emsdk('update-tags')
    print('test tot-upstream')
    run_emsdk('install tot-upstream')
    with open(emconfig) as f:
      config = f.read()
    run_emsdk('activate tot-upstream')
    with open(emconfig + '.old') as f:
      old_config = f.read()
    self.assertEqual(config, old_config)
    # TODO; test on latest as well
    check_call(upstream_emcc + ' hello_world.c')

  def test_closure(self):
    # Specifically test with `--closure` so we know that node_modules is working
    check_call(upstream_emcc + ' hello_world.c --closure=1')

  def test_specific_version(self):
    if MACOS_ARM64:
      self.skipTest('Old sdk versions do not have ARM64 binaries')
    print('test specific release (new, short name)')
    run_emsdk('install 1.38.33')
    print('another install, but no need for re-download')
    checked_call_with_output(emsdk + ' install 1.38.33', expected='Skipped', unexpected='Downloading:')
    run_emsdk('activate 1.38.33')

  def test_specific_version_full(self):
    if MACOS_ARM64:
      self.skipTest('Old sdk versions do not have ARM64 binaries')
    print('test specific release (new, full name)')
    run_emsdk('install sdk-1.38.33-64bit')
    run_emsdk('activate sdk-1.38.33-64bit')
    print('test specific release (new, tag name)')
    run_emsdk('install sdk-tag-1.38.33-64bit')
    run_emsdk('activate sdk-tag-1.38.33-64bit')

  def test_binaryen_from_source(self):
    if MACOS:
      self.skipTest("https://github.com/WebAssembly/binaryen/issues/4299")
    print('test binaryen source build')
    run_emsdk(['install', '--build=Release', '--generator=Unix Makefiles', 'binaryen-main-64bit'])

  def test_no_32bit(self):
    print('test 32-bit error')
    emsdk_hacked = hack_emsdk('not is_os_64bit()', 'True')
    failing_call_with_output('%s %s install latest' % (sys.executable, emsdk_hacked),
                             'this tool is only provided for 64-bit OSes')
    os.remove(emsdk_hacked)

  def test_update_no_git(self):
    print('test non-git update')

    temp_dir = tempfile.mkdtemp()
    for filename in os.listdir('.'):
      if not filename.startswith('.') and not os.path.isdir(filename):
        shutil.copy2(filename, os.path.join(temp_dir, filename))

    olddir = os.getcwd()
    try:
      os.chdir(temp_dir)
      run_emsdk('update')

      print('second time')
      run_emsdk('update')
    finally:
      os.chdir(olddir)

  def test_install_arbitrary(self):
    # Test that its possible to install arbrary emscripten-releases SDKs
    run_emsdk('install 1b7f7bc6002a3ca73647f41fc10e1fac7f06f804')

    # Check that its not re-downloaded
    checked_call_with_output(emsdk + ' install 1b7f7bc6002a3ca73647f41fc10e1fac7f06f804', expected='Skipped', unexpected='Downloading:')

  def test_install_tool(self):
    # Test that its possible to install emscripten as tool instead of SDK
    checked_call_with_output(emsdk + ' install releases-77b065ace39e6ab21446e13f92897f956c80476a', unexpected='Installing SDK')

  def test_activate_missing(self):
    run_emsdk('install latest')
    failing_call_with_output(emsdk + ' activate 2.0.1', expected="error: tool is not installed and therefore cannot be activated: 'releases-13e29bd55185e3c12802bc090b4507901856b2ba-64bit'")

  def test_keep_downloads(self):
    env = os.environ.copy()
    env['EMSDK_KEEP_DOWNLOADS'] = '1'
    # With EMSDK_KEEP_DOWNLOADS the downloading should happen on the first
    # install of 2.0.28, and again when we install 2.0.29, but not on the
    # second install of 2.0.28 because the zip should already be local.
    shutil.rmtree('downloads')
    checked_call_with_output(emsdk + ' install 3.1.54', expected='Downloading:', env=env)
    checked_call_with_output(emsdk + ' install 3.1.55', expected='Downloading:', env=env)
    checked_call_with_output(emsdk + ' install 3.1.54', expected='already downloaded, skipping', unexpected='Downloading:', env=env)


if __name__ == '__main__':
  unittest.main(verbosity=2)
