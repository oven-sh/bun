#!/usr/bin/env python3
# Copyright 2020 The Emscripten Authors.  All rights reserved.
# Emscripten is available under two separate licenses, the MIT license and the
# University of Illinois/NCSA Open Source License.  Both these licenses can be
# found in the LICENSE file.

"""Updates the python binaries that we cache store at
http://storage.google.com/webassembly.

We only supply binaries for windows and macOS, but we do it very different ways for those two OSes.
On Linux, we depend on the system version of python.

Windows recipe:
  1. Download precompiled version of python from NuGet package manager,
     either the package "python" for AMD64, or "pythonarm64" for ARM64.
  2. Set up pip and install pywin32 and psutil via pip for emrun to work.
  3. Re-zip and upload to storage.google.com

macOS recipe:
  1. Clone cpython
  2. Use homebrew to install and configure openssl (for static linking!)
  3. Build cpython from source and use `make install` to create archive.
"""

import glob
import multiprocessing
import os
import platform
import urllib.request
import shutil
import subprocess
import sys
from subprocess import check_call
from zip import unzip_cmd, zip_cmd

version = '3.13.3'
major_minor_version = '.'.join(version.split('.')[:2])  # e.g. '3.9.2' -> '3.9'
# This is not part of official Python version, but a repackaging number appended by emsdk
# when a version of Python needs to be redownloaded.
revision = '0'

PSUTIL = 'psutil==7.0.0'

upload_base = 'gs://webassembly/emscripten-releases-builds/deps/'


# Detects whether current python interpreter architecture is ARM64 or AMD64
# If running AMD64 python on an ARM64 Windows, this still intentionally returns AMD64
def find_python_arch():
    import sysconfig
    arch = sysconfig.get_platform().lower()
    if 'amd64' in arch:
        return 'amd64'
    if 'arm64' in arch:
        return 'arm64'
    raise f'Unknown Python sysconfig platform "{arch}" (neither AMD64 or ARM64)'


def make_python_patch():
    python_arch = find_python_arch()
    package_name = 'pythonarm64' if python_arch == 'arm64' else 'python'
    download_url = f'https://www.nuget.org/api/v2/package/{package_name}/{version}'
    filename = f'python-{version}-win-{python_arch}.zip'
    out_filename = f'python-{version}-{revision}-win-{python_arch}.zip'

    if not os.path.exists(filename):
        print(f'Downloading python: {download_url} to {filename}')
        urllib.request.urlretrieve(download_url, filename)

    os.mkdir('python-nuget')
    check_call(unzip_cmd() + [os.path.abspath(filename)], cwd='python-nuget')
    os.remove(filename)

    src_dir = os.path.join('python-nuget', 'tools')
    python_exe = os.path.join(src_dir, 'python.exe')
    check_call([python_exe, '-m', 'ensurepip', '--upgrade'])
    check_call([python_exe, '-m', 'pip', 'install', 'pywin32==310', '--no-warn-script-location'])
    check_call([python_exe, '-m', 'pip', 'install', PSUTIL])

    check_call(zip_cmd() + [os.path.join('..', '..', out_filename), '.'], cwd=src_dir)
    print('Created: %s' % out_filename)

    # cleanup if everything went fine
    shutil.rmtree('python-nuget')

    if '--upload' in sys.argv:
      upload_url = upload_base + out_filename
      print('Uploading: ' + upload_url)
      cmd = ['gsutil', 'cp', '-n', out_filename, upload_url]
      print(' '.join(cmd))
      check_call(cmd)


def build_python():
    if sys.platform.startswith('darwin'):
        # Take some rather drastic steps to link openssl and liblzma statically
        # and avoid linking libintl completely.
        osname = 'macos'
        check_call(['brew', 'install', 'openssl', 'xz', 'pkg-config'])
        if platform.machine() == 'x86_64':
            prefix = '/usr/local'
            min_macos_version = '11.0'
        elif platform.machine() == 'arm64':
            prefix = '/opt/homebrew'
            min_macos_version = '11.0'

        # Append '-x86_64' or '-arm64' depending on current arch. (TODO: Do
        # this for Linux too, move this below?)
        osname += '-' + platform.machine()

        for f in [os.path.join(prefix, 'lib', 'libintl.dylib'),
                  os.path.join(prefix, 'include', 'libintl.h'),
                  os.path.join(prefix, 'opt', 'xz', 'lib', 'liblzma.dylib'),
                  os.path.join(prefix, 'opt', 'openssl', 'lib', 'libssl.dylib'),
                  os.path.join(prefix, 'opt', 'openssl', 'lib', 'libcrypto.dylib')]:
            if os.path.exists(f):
                os.remove(f)
        os.environ['PKG_CONFIG_PATH'] = os.path.join(prefix, 'opt', 'openssl', 'lib', 'pkgconfig')
    else:
        osname = 'linux'

    src_dir = 'cpython'
    if os.path.exists(src_dir):
      check_call(['git', 'fetch'], cwd=src_dir)
    else:
      check_call(['git', 'clone', 'https://github.com/python/cpython'])
    check_call(['git', 'checkout', 'v' + version], cwd=src_dir)

    env = os.environ
    if sys.platform.startswith('darwin'):
      # Specify the min OS version we want the build to work on
      min_macos_version_line = '-mmacosx-version-min=' + min_macos_version
      build_flags = min_macos_version_line + ' -Werror=partial-availability'
      # Build against latest SDK, but issue an error if using any API that would not work on the min OS version
      env = env.copy()
      env['MACOSX_DEPLOYMENT_TARGET'] = min_macos_version
      configure_args = ['CFLAGS=' + build_flags, 'CXXFLAGS=' + build_flags, 'LDFLAGS=' + min_macos_version_line]
    else:
      configure_args = []
    check_call(['./configure'] + configure_args, cwd=src_dir, env=env)
    check_call(['make', '-j', str(multiprocessing.cpu_count())], cwd=src_dir, env=env)
    check_call(['make', 'install', 'DESTDIR=install'], cwd=src_dir, env=env)

    install_dir = os.path.join(src_dir, 'install')

    # Install requests module.  This is needed in particular on macOS to ensure
    # SSL certificates are available (certifi in installed and used by requests).
    pybin = os.path.join(src_dir, 'install', 'usr', 'local', 'bin', 'python3')
    pip = os.path.join(src_dir, 'install', 'usr', 'local', 'bin', 'pip3')
    check_call([pybin, '-m', 'ensurepip', '--upgrade'])
    check_call([pybin, pip, 'install', 'requests==2.32.3'])

    # Install psutil module. This is needed by emrun to track when browser
    # process quits.
    check_call([pybin, pip, 'install', PSUTIL])

    dirname = 'python-%s-%s' % (version, revision)
    if os.path.isdir(dirname):
        print('Erasing old build directory ' + dirname)
        shutil.rmtree(dirname)
    os.rename(os.path.join(install_dir, 'usr', 'local'), dirname)
    tarball = 'python-%s-%s-%s.tar.gz' % (version, revision, osname)
    shutil.rmtree(os.path.join(dirname, 'lib', 'python' + major_minor_version, 'test'))
    shutil.rmtree(os.path.join(dirname, 'include'))
    for lib in glob.glob(os.path.join(dirname, 'lib', 'lib*.a')):
        os.remove(lib)
    check_call(['tar', 'zcvf', tarball, dirname])

    print('Created: %s' % tarball)
    if '--upload' in sys.argv:
      print('Uploading: ' + upload_base + tarball)
      check_call(['gsutil', 'cp', '-n', tarball, upload_base + tarball])


def main():
    if sys.platform.startswith('win') or '--win32' in sys.argv:
        make_python_patch()
    else:
        build_python()
    return 0


if __name__ == '__main__':
  sys.exit(main())
