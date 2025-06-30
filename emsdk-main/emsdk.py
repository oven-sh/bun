#!/usr/bin/env python
# Copyright 2019 The Emscripten Authors.  All rights reserved.
# Emscripten is available under two separate licenses, the MIT license and the
# University of Illinois/NCSA Open Source License.  Both these licenses can be
# found in the LICENSE file.

from __future__ import print_function

import copy
from collections import OrderedDict
import errno
import json
import multiprocessing
import os
import os.path
import platform
import re
import shutil
import stat
import subprocess
import sys
import sysconfig
import zipfile
if os.name == 'nt':
  try:
    import winreg
  except ImportError:
    # old python 2 name
    import _winreg as winreg
  import ctypes.wintypes

if sys.version_info >= (3,):
  from urllib.parse import urljoin
  from urllib.request import urlopen
  import functools
else:
  from urlparse import urljoin
  from urllib2 import urlopen


emsdk_packages_url = 'https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/'

emscripten_releases_repo = 'https://chromium.googlesource.com/emscripten-releases'

emscripten_releases_download_url_template = "https://storage.googleapis.com/webassembly/emscripten-releases-builds/%s/%s/wasm-binaries%s.%s"

# This was previously `master.zip` but we are transitioning to `main` and
# `HEAD.zip` works for both cases.  In future we could switch this to
# `main.zip` perhaps.
emsdk_zip_download_url = 'https://github.com/emscripten-core/emsdk/archive/HEAD.zip'

download_dir = 'downloads/'

extra_release_tag = None

# Enable this to do very verbose printing about the different steps that are
# being run. Useful for debugging.
VERBOSE = int(os.getenv('EMSDK_VERBOSE', '0'))
QUIET = int(os.getenv('EMSDK_QUIET', '0'))
TTY_OUTPUT = not os.getenv('EMSDK_NOTTY', not sys.stdout.isatty())


def info(msg):
  if not QUIET:
    print(msg, file=sys.stderr)


def errlog(msg):
  print(msg, file=sys.stderr)


def exit_with_error(msg):
  errlog('error: %s' % msg)
  sys.exit(1)


WINDOWS = False
MINGW = False
MSYS = False
MACOS = False
LINUX = False

if 'EMSDK_OS' in os.environ:
  EMSDK_OS = os.environ['EMSDK_OS']
  if EMSDK_OS == 'windows':
    WINDOWS = True
  elif EMSDK_OS == 'linux':
    LINUX = True
  elif EMSDK_OS == 'macos':
    MACOS = True
  else:
    assert False, 'EMSDK_OS must be one of: windows, linux, macos'
else:
  if os.name == 'nt' or ('windows' in os.getenv('SYSTEMROOT', '').lower()) or ('windows' in os.getenv('COMSPEC', '').lower()):
    WINDOWS = True

  if os.getenv('MSYSTEM'):
    MSYS = True
    # Some functions like os.path.normpath() exhibit different behavior between
    # different versions of Python, so we need to distinguish between the MinGW
    # and MSYS versions of Python
    if sysconfig.get_platform() == 'mingw':
      MINGW = True
    if os.getenv('MSYSTEM') != 'MSYS' and os.getenv('MSYSTEM') != 'MINGW64':
      # https://stackoverflow.com/questions/37460073/msys-vs-mingw-internal-environment-variables
      errlog('Warning: MSYSTEM environment variable is present, and is set to "' + os.getenv('MSYSTEM') + '". This shell has not been tested with emsdk and may not work.')

  if platform.mac_ver()[0] != '':
    MACOS = True

  if not MACOS and (platform.system() == 'Linux'):
    LINUX = True

UNIX = (MACOS or LINUX)


# Pick which shell of 4 shells to use
POWERSHELL = bool(os.getenv('EMSDK_POWERSHELL'))
CSH = bool(os.getenv('EMSDK_CSH'))
CMD = bool(os.getenv('EMSDK_CMD'))
BASH = bool(os.getenv('EMSDK_BASH'))
FISH = bool(os.getenv('EMSDK_FISH'))

if WINDOWS and BASH:
  MSYS = True

if not CSH and not POWERSHELL and not BASH and not CMD and not FISH:
  # Fall back to default of `cmd` on windows and `bash` otherwise
  if WINDOWS and not MSYS:
    CMD = True
  else:
    BASH = True

if WINDOWS:
  ENVPATH_SEPARATOR = ';'
else:
  ENVPATH_SEPARATOR = ':'

# platform.machine() may return AMD64 on windows, so standardize the case.
machine = os.getenv('EMSDK_ARCH', platform.machine().lower())
if machine.startswith('x64') or machine.startswith('amd64') or machine.startswith('x86_64'):
  ARCH = 'x86_64'
elif machine.endswith('86'):
  ARCH = 'x86'
elif machine.startswith('aarch64') or machine.lower().startswith('arm64'):
  ARCH = 'arm64'
elif machine.startswith('arm'):
  ARCH = 'arm'
else:
  exit_with_error('unknown machine architecture: ' + machine)


# Don't saturate all cores to not steal the whole system, but be aggressive.
CPU_CORES = int(os.getenv('EMSDK_NUM_CORES', max(multiprocessing.cpu_count() - 1, 1)))

CMAKE_BUILD_TYPE_OVERRIDE = None

# If true, perform a --shallow clone of git.
GIT_CLONE_SHALLOW = False

# If true, LLVM backend is built with tests enabled, and Binaryen is built with
# Visual Studio static analyzer enabled.
BUILD_FOR_TESTING = False

# If 'auto', assertions are decided by the build type
# (Release&MinSizeRel=disabled, Debug&RelWithDebInfo=enabled)
# Other valid values are 'ON' and 'OFF'
ENABLE_LLVM_ASSERTIONS = 'auto'

# If true, keeps the downloaded archive files.
KEEP_DOWNLOADS = bool(os.getenv('EMSDK_KEEP_DOWNLOADS'))


def os_name():
  if WINDOWS:
    return 'win'
  elif LINUX:
    return 'linux'
  elif MACOS:
    return 'mac'
  else:
    raise Exception('unknown OS')


def debug_print(msg):
  if VERBOSE:
    errlog(msg)


def to_unix_path(p):
  return p.replace('\\', '/')


EMSDK_PATH = to_unix_path(os.path.dirname(os.path.realpath(__file__)))

EMSDK_SET_ENV = ""
if POWERSHELL:
  EMSDK_SET_ENV = os.path.join(EMSDK_PATH, 'emsdk_set_env.ps1')
else:
  EMSDK_SET_ENV = os.path.join(EMSDK_PATH, 'emsdk_set_env.bat')


# Parses https://github.com/emscripten-core/emscripten/tree/d6aced8 to a pair (https://github.com/emscripten-core/emscripten, d6aced8)
def parse_github_url_and_refspec(url):
  if not url:
    return ('', '')

  if url.endswith(('/tree/', '/tree', '/commit/', '/commit')):
    raise Exception('Malformed git URL and refspec ' + url + '!')

  if '/tree/' in url:
    if url.endswith('/'):
      raise Exception('Malformed git URL and refspec ' + url + '!')
    return url.split('/tree/')
  elif '/commit/' in url:
    if url.endswith('/'):
      raise Exception('Malformed git URL and refspec ' + url + '!')
    return url.split('/commit/')
  else:
    return (url, 'main')  # Assume the default branch is main in the absence of a refspec


ARCHIVE_SUFFIXES = ('zip', '.tar', '.gz', '.xz', '.tbz2', '.bz2')


# Finds the given executable 'program' in PATH. Operates like the Unix tool 'which'.
def which(program):
  def is_exe(fpath):
    return os.path.isfile(fpath) and (WINDOWS or os.access(fpath, os.X_OK))

  fpath, fname = os.path.split(program)
  if fpath:
    if is_exe(program):
      return program
  else:
    for path in os.environ["PATH"].split(os.pathsep):
      path = path.strip('"')
      exe_file = os.path.join(path, program)
      if is_exe(exe_file):
        return exe_file

      if WINDOWS and '.' not in fname:
        if is_exe(exe_file + '.exe'):
          return exe_file + '.exe'
        if is_exe(exe_file + '.cmd'):
          return exe_file + '.cmd'
        if is_exe(exe_file + '.bat'):
          return exe_file + '.bat'

  return None


def vswhere(version):
  try:
    program_files = os.getenv('ProgramFiles(x86)')
    if not program_files:
      program_files = os.environ['ProgramFiles']
    vswhere_path = os.path.join(program_files, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    # Source: https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022
    tools_arch = 'ARM64' if ARCH == 'arm64' else 'x86.x64'
    # The "-products *" allows detection of Build Tools, the "-prerelease" allows detection of Preview version
    # of Visual Studio and Build Tools.
    output = json.loads(subprocess.check_output([vswhere_path, '-latest', '-products', '*', '-prerelease', '-version', '[%s.0,%s.0)' % (version, version + 1), '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.' + tools_arch, '-property', 'installationPath', '-format', 'json']))
    return str(output[0]['installationPath'])
  except Exception:
    return ''


def vs_filewhere(installation_path, platform, file):
  try:
    vcvarsall = os.path.join(installation_path, 'VC\\Auxiliary\\Build\\vcvarsall.bat')
    env = subprocess.check_output('cmd /c "%s" %s & where %s' % (vcvarsall, platform, file))
    paths = [path[:-len(file)] for path in env.split('\r\n') if path.endswith(file)]
    return paths[0]
  except Exception:
    return ''


CMAKE_GENERATOR = 'Unix Makefiles'
if WINDOWS:
  # Detect which CMake generator to use when building on Windows
  if '--mingw' in sys.argv:
    CMAKE_GENERATOR = 'MinGW Makefiles'
  elif '--vs2022' in sys.argv:
    CMAKE_GENERATOR = 'Visual Studio 17'
  elif '--vs2019' in sys.argv:
    CMAKE_GENERATOR = 'Visual Studio 16'
  elif len(vswhere(17)) > 0:
    CMAKE_GENERATOR = 'Visual Studio 17'
  elif len(vswhere(16)) > 0:
    CMAKE_GENERATOR = 'Visual Studio 16'
  elif which('mingw32-make') is not None and which('g++') is not None:
    CMAKE_GENERATOR = 'MinGW Makefiles'
  else:
    # No detected generator
    CMAKE_GENERATOR = ''


sys.argv = [a for a in sys.argv if a not in ('--mingw', '--vs2019', '--vs2022')]


# Computes a suitable path prefix to use when building with a given generator.
def cmake_generator_prefix():
  if CMAKE_GENERATOR == 'Visual Studio 17':
    return '_vs2022'
  if CMAKE_GENERATOR == 'Visual Studio 16':
    return '_vs2019'
  elif CMAKE_GENERATOR == 'MinGW Makefiles':
    return '_mingw'
  # Unix Makefiles do not specify a path prefix for backwards path compatibility
  return ''


# Removes a directory tree even if it was readonly, and doesn't throw exception
# on failure.
def remove_tree(d):
  debug_print('remove_tree(' + str(d) + ')')
  if not os.path.exists(d):
    return
  try:
    def remove_readonly_and_try_again(func, path, exc_info):
      if not (os.stat(path).st_mode & stat.S_IWRITE):
        os.chmod(path, stat.S_IWRITE)
        func(path)
      else:
        raise
    shutil.rmtree(d, onerror=remove_readonly_and_try_again)
  except Exception as e:
    debug_print('remove_tree threw an exception, ignoring: ' + str(e))


def win_set_environment_variable_direct(key, value, system=True):
  folder = None
  try:
    if system:
      # Read globally from ALL USERS section.
      folder = winreg.OpenKeyEx(winreg.HKEY_LOCAL_MACHINE, 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 0, winreg.KEY_ALL_ACCESS)
    else:
      # Register locally from CURRENT USER section.
      folder = winreg.OpenKeyEx(winreg.HKEY_CURRENT_USER, 'Environment', 0, winreg.KEY_ALL_ACCESS)
    winreg.SetValueEx(folder, key, 0, winreg.REG_EXPAND_SZ, value)
    debug_print('Set key=' + key + ' with value ' + value + ' in registry.')
    return True
  except Exception as e:
    # 'Access is denied.'
    if e.args[3] == 5:
      exit_with_error('failed to set the environment variable \'' + key + '\'! Setting environment variables permanently requires administrator access. Please rerun this command with administrative privileges. This can be done for example by holding down the Ctrl and Shift keys while opening a command prompt in start menu.')
    errlog('Failed to write environment variable ' + key + ':')
    errlog(str(e))
    return False
  finally:
    if folder is not None:
      folder.Close()


def win_get_environment_variable(key, system=True, user=True, fallback=True):
  if (not system and not user and fallback):
    # if no --system or --permanent flag is provided use shell's value
    return os.environ[key]
  try:
    folder = None
    try:
      if system:
        # Read globally from ALL USERS section.
        folder = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
      else:
        # Register locally from CURRENT USER section.
        folder = winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment')
      value = str(winreg.QueryValueEx(folder, key)[0])
    except Exception:
      # If reading registry fails for some reason - read via os.environ. This has the drawback
      # that expansion items such as %PROGRAMFILES% will have been expanded, so
      # need to be precise not to set these back to system registry, or
      # expansion items would be lost.
      if fallback:
        return os.environ[key]
      return None
    finally:
      if folder is not None:
        folder.Close()

  except Exception as e:
    # this catch is if both the registry key threw an exception and the key is not in os.environ
    if e.args[0] != 2:
      # 'The system cannot find the file specified.'
      errlog('Failed to read environment variable ' + key + ':')
      errlog(str(e))
    return None
  return value


def win_set_environment_variable(key, value, system, user):
  debug_print('set ' + str(key) + '=' + str(value) + ', in system=' + str(system))
  previous_value = win_get_environment_variable(key, system=system, user=user)
  if previous_value == value:
    debug_print('  no need to set, since same value already exists.')
    # No need to elevate UAC for nothing to set the same value, skip.
    return False

  if not value:
    try:
      if system:
        cmd = ['REG', 'DELETE', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', '/V', key, '/f']
      else:
        cmd = ['REG', 'DELETE', 'HKCU\\Environment', '/V', key, '/f']
      debug_print(str(cmd))
      value = subprocess.call(cmd, stdout=subprocess.PIPE)
    except Exception:
      return False
    return True

  try:
    if win_set_environment_variable_direct(key, value, system):
      return True
    # Escape % signs so that we don't expand references to environment variables.
    value = value.replace('%', '^%')
    if len(value) >= 1024:
      exit_with_error('the new environment variable ' + key + ' is more than 1024 characters long! A value this long cannot be set via command line: please add the environment variable specified above to system environment manually via Control Panel.')
    cmd = ['SETX', key, value]
    debug_print(str(cmd))
    retcode = subprocess.call(cmd, stdout=subprocess.PIPE)
    if retcode != 0:
      errlog('ERROR! Failed to set environment variable ' + key + '=' + value + '. You may need to set it manually.')
    else:
      return True
  except Exception as e:
    errlog('ERROR! Failed to set environment variable ' + key + '=' + value + ':')
    errlog(str(e))
    errlog('You may need to set it manually.')

  return False


def win_set_environment_variables(env_vars_to_add, system, user):
  if not env_vars_to_add:
    return

  changed = False

  for key, value in env_vars_to_add:
    if win_set_environment_variable(key, value, system, user):
      if not changed:
        changed = True
        print('Setting global environment variables:')

      print(key + ' = ' + value)

  if not changed:
    print('Global environment variables up to date')
    return

  # if changes were made then we need to notify other processes
  try:
    HWND_BROADCAST = ctypes.wintypes.HWND(0xFFFF)  # win32con.HWND_BROADCAST == 65535
    WM_SETTINGCHANGE = 0x001A  # win32con.WM_SETTINGCHANGE == 26
    SMTO_BLOCK = 0x0001  # win32con.SMTO_BLOCK == 1
    ctypes.windll.user32.SendMessageTimeoutA(
      HWND_BROADCAST,    # hWnd: notify everyone
      WM_SETTINGCHANGE,  # Msg: registry changed
      0,                 # wParam: Must be 0 when setting changed is sent by users
      'Environment',     # lParam: Specifically environment variables changed
      SMTO_BLOCK,        # fuFlags: Wait for message to be sent or timeout
      100)               # uTimeout: 100ms
  except Exception as e:
    errlog('SendMessageTimeout failed with error: ' + str(e))


def win_delete_environment_variable(key, system=True, user=True):
  debug_print('win_delete_environment_variable(key=' + key + ', system=' + str(system) + ')')
  return win_set_environment_variable(key, None, system, user)


# Returns the absolute pathname to the given path inside the Emscripten SDK.
def sdk_path(path):
  if os.path.isabs(path):
    return path

  return to_unix_path(os.path.join(EMSDK_PATH, path))


# Removes a single file, suppressing exceptions on failure.
def rmfile(filename):
  debug_print('rmfile(' + filename + ')')
  if os.path.lexists(filename):
    os.remove(filename)


# http://stackoverflow.com/questions/600268/mkdir-p-functionality-in-python
def mkdir_p(path):
  debug_print('mkdir_p(' + path + ')')
  try:
    os.makedirs(path)
  except OSError as exc:  # Python >2.5
    if exc.errno != errno.EEXIST or not os.path.isdir(path):
      raise


def is_nonempty_directory(path):
  if not os.path.isdir(path):
    return False
  return len(os.listdir(path)) != 0


def run(cmd, cwd=None, quiet=False):
  debug_print('run(cmd=' + str(cmd) + ', cwd=' + str(cwd) + ')')
  process = subprocess.Popen(cmd, cwd=cwd, env=os.environ.copy())
  process.communicate()
  if process.returncode != 0 and not quiet:
    errlog(str(cmd) + ' failed with error code ' + str(process.returncode) + '!')
  return process.returncode


# http://pythonicprose.blogspot.fi/2009/10/python-extract-targz-archive.html
def untargz(source_filename, dest_dir):
  print("Unpacking '" + source_filename + "' to '" + dest_dir + "'")
  mkdir_p(dest_dir)
  returncode = run(['tar', '-xvf' if VERBOSE else '-xf', sdk_path(source_filename), '--strip', '1'], cwd=dest_dir)
  # tfile = tarfile.open(source_filename, 'r:gz')
  # tfile.extractall(dest_dir)
  return returncode == 0


# On Windows, it is not possible to reference path names that are longer than
# ~260 characters, unless the path is referenced via a "\\?\" prefix.
# See https://msdn.microsoft.com/en-us/library/aa365247.aspx#maxpath and http://stackoverflow.com/questions/3555527/python-win32-filename-length-workaround
# In that mode, forward slashes cannot be used as delimiters.
def fix_potentially_long_windows_pathname(pathname):
  if not WINDOWS or MSYS:
    return pathname
  # Test if emsdk calls fix_potentially_long_windows_pathname() with long
  # relative paths (which is problematic)
  if not os.path.isabs(pathname) and len(pathname) > 200:
    errlog('Warning: Seeing a relative path "' + pathname + '" which is dangerously long for being referenced as a short Windows path name. Refactor emsdk to be able to handle this!')
  if pathname.startswith('\\\\?\\'):
    return pathname
  pathname = os.path.normpath(pathname.replace('/', '\\'))
  if MINGW:
    # MinGW versions of Python return normalized paths with backslashes
    # converted to forward slashes, so we must use forward slashes in our
    # prefix
    return '//?/' + pathname
  return '\\\\?\\' + pathname


# On windows, rename/move will fail if the destination exists, and there is no
# race-free way to do it. This method removes the destination if it exists, so
# the move always works
def move_with_overwrite(src, dest):
  if os.path.exists(dest):
    os.remove(dest)
  os.rename(src, dest)


# http://stackoverflow.com/questions/12886768/simple-way-to-unzip-file-in-python-on-all-oses
def unzip(source_filename, dest_dir):
  print("Unpacking '" + source_filename + "' to '" + dest_dir + "'")
  mkdir_p(dest_dir)
  common_subdir = None
  try:
    with zipfile.ZipFile(source_filename) as zf:
      # Implement '--strip 1' behavior to unzipping by testing if all the files
      # in the zip reside in a common subdirectory, and if so, we move the
      # output tree at the end of uncompression step.
      for member in zf.infolist():
        words = member.filename.split('/')
        if len(words) > 1:  # If there is a directory component?
          if common_subdir is None:
            common_subdir = words[0]
          elif common_subdir != words[0]:
            common_subdir = None
            break
        else:
          common_subdir = None
          break

      unzip_to_dir = dest_dir
      if common_subdir:
        unzip_to_dir = os.path.join(os.path.dirname(dest_dir), 'unzip_temp')

      # Now do the actual decompress.
      for member in zf.infolist():
        zf.extract(member, fix_potentially_long_windows_pathname(unzip_to_dir))
        dst_filename = os.path.join(unzip_to_dir, member.filename)

        # See: https://stackoverflow.com/questions/42326428/zipfile-in-python-file-permission
        unix_attributes = member.external_attr >> 16
        if unix_attributes:
          os.chmod(dst_filename, unix_attributes)

        # Move the extracted file to its final location without the base
        # directory name, if we are stripping that away.
        if common_subdir:
          if not member.filename.startswith(common_subdir):
            raise Exception('Unexpected filename "' + member.filename + '"!')
          stripped_filename = '.' + member.filename[len(common_subdir):]
          final_dst_filename = os.path.join(dest_dir, stripped_filename)
          # Check if a directory
          if stripped_filename.endswith('/'):
            d = fix_potentially_long_windows_pathname(final_dst_filename)
            if not os.path.isdir(d):
              os.mkdir(d)
          else:
            parent_dir = os.path.dirname(fix_potentially_long_windows_pathname(final_dst_filename))
            if parent_dir and not os.path.exists(parent_dir):
              os.makedirs(parent_dir)
            move_with_overwrite(fix_potentially_long_windows_pathname(dst_filename), fix_potentially_long_windows_pathname(final_dst_filename))

      if common_subdir:
        remove_tree(unzip_to_dir)
  except zipfile.BadZipfile as e:
    errlog("Unzipping file '" + source_filename + "' failed due to reason: " + str(e) + "! Removing the corrupted zip file.")
    rmfile(source_filename)
    return False
  except Exception as e:
    errlog("Unzipping file '" + source_filename + "' failed due to reason: " + str(e))
    return False

  return True


# This function interprets whether the given string looks like a path to a
# directory instead of a file, without looking at the actual filesystem.
# 'a/b/c' points to directory, so does 'a/b/c/', but 'a/b/c.x' is parsed as a
# filename
def path_points_to_directory(path):
  if path == '.':
     return True
  last_slash = max(path.rfind('/'), path.rfind('\\'))
  last_dot = path.rfind('.')
  no_suffix = last_dot < last_slash or last_dot == -1
  if no_suffix:
    return True
  suffix = path[last_dot:]
  # Very simple logic for the only file suffixes used by emsdk downloader. Other
  # suffixes, like 'clang-3.2' are treated as dirs.
  if suffix in ('.exe', '.zip', '.txt'):
    return False
  else:
    return True


def get_content_length(download):
  try:
    meta = download.info()
    if hasattr(meta, "getheaders") and hasattr(meta.getheaders, "Content-Length"):
      return int(meta.getheaders("Content-Length")[0])
    elif hasattr(download, "getheader") and download.getheader('Content-Length'):
      return int(download.getheader('Content-Length'))
    elif hasattr(meta, "getheader") and meta.getheader('Content-Length'):
      return int(meta.getheader('Content-Length'))
  except Exception:
    pass

  return 0


def get_download_target(url, dstpath, filename_prefix=''):
  file_name = filename_prefix + url.split('/')[-1]
  if path_points_to_directory(dstpath):
    file_name = os.path.join(dstpath, file_name)
  else:
    file_name = dstpath

  # Treat all relative destination paths as relative to the SDK root directory,
  # not the current working directory.
  file_name = sdk_path(file_name)

  return file_name


def download_with_curl(url, file_name):
  print("Downloading: %s from %s" % (file_name, url))
  if not which('curl'):
    exit_with_error('curl not found in PATH')
  # -#: show progress bar
  # -L: Follow HTTP 3XX redirections
  # -f: Fail on HTTP errors
  subprocess.check_call(['curl', '-#', '-f', '-L', '-o', file_name, url])


def download_with_urllib(url, file_name):
  u = urlopen(url)
  file_size = get_content_length(u)
  if file_size > 0:
    print("Downloading: %s from %s, %s Bytes" % (file_name, url, file_size))
  else:
    print("Downloading: %s from %s" % (file_name, url))

  file_size_dl = 0
  # Draw a progress bar 80 chars wide (in non-TTY mode)
  progress_max = 80 - 4
  progress_shown = 0
  block_sz = 256 * 1024
  if not TTY_OUTPUT:
      print(' [', end='')

  with open(file_name, 'wb') as f:
    while True:
        buffer = u.read(block_sz)
        if not buffer:
            break

        file_size_dl += len(buffer)
        f.write(buffer)
        if file_size:
            percent = file_size_dl * 100.0 / file_size
            if TTY_OUTPUT:
                status = r" %10d  [%3.02f%%]" % (file_size_dl, percent)
                print(status, end='\r')
            else:
                while progress_shown < progress_max * percent / 100:
                    print('-', end='')
                    sys.stdout.flush()
                    progress_shown += 1

  if not TTY_OUTPUT:
    print(']')
    sys.stdout.flush()

  debug_print('finished downloading (%d bytes)' % file_size_dl)


# On success, returns the filename on the disk pointing to the destination file that was produced
# On failure, returns None.
def download_file(url, dstpath, download_even_if_exists=False,
                  filename_prefix='', silent=False):
  debug_print('download_file(url=' + url + ', dstpath=' + dstpath + ')')
  file_name = get_download_target(url, dstpath, filename_prefix)

  if os.path.exists(file_name) and not download_even_if_exists:
    print("File '" + file_name + "' already downloaded, skipping.")
    return file_name

  mkdir_p(os.path.dirname(file_name))

  try:
    # Use curl on macOS to avoid CERTIFICATE_VERIFY_FAILED issue with
    # python's urllib:
    # https://stackoverflow.com/questions/40684543/how-to-make-python-use-ca-certificates-from-mac-os-truststore
    # Unlike on linux or windows, curl is always available on macOS systems.
    if MACOS:
      download_with_curl(url, file_name)
    else:
      download_with_urllib(url, file_name)
  except Exception as e:
    errlog("Error: Downloading URL '" + url + "': " + str(e))
    return None
  except KeyboardInterrupt:
    rmfile(file_name)
    raise

  return file_name


def run_get_output(cmd, cwd=None):
  debug_print('run_get_output(cmd=' + str(cmd) + ', cwd=' + str(cwd) + ')')
  process = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.PIPE, env=os.environ.copy(), universal_newlines=True)
  stdout, stderr = process.communicate()
  return (process.returncode, stdout, stderr)


cached_git_executable = None


# must_succeed: If false, the search is performed silently without printing out
#               errors if not found. Empty string is returned if git is not found.
#               If true, the search is required to succeed, and the execution
#               will terminate with sys.exit(1) if not found.
def GIT(must_succeed=True):
  global cached_git_executable
  if cached_git_executable is not None:
    return cached_git_executable
  # The order in the following is important, and specifies the preferred order
  # of using the git tools.  Primarily use git from emsdk if installed. If not,
  # use system git.
  gits = ['git/1.9.4/bin/git.exe', which('git')]
  for git in gits:
    try:
      ret, stdout, stderr = run_get_output([git, '--version'])
      if ret == 0:
        cached_git_executable = git
        return git
    except Exception:
      pass
  if must_succeed:
    if WINDOWS:
      msg = "git executable was not found. Please install it by typing 'emsdk install git-1.9.4', or alternatively by installing it manually from http://git-scm.com/downloads . If you install git manually, remember to add it to PATH"
    elif MACOS:
      msg = "git executable was not found. Please install git for this operation! This can be done from http://git-scm.com/ , or by installing XCode and then the XCode Command Line Tools (see http://stackoverflow.com/questions/9329243/xcode-4-4-command-line-tools )"
    elif LINUX:
      msg = "git executable was not found. Please install git for this operation! This can be probably be done using your package manager, see http://git-scm.com/book/en/Getting-Started-Installing-Git"
    else:
      msg = "git executable was not found. Please install git for this operation!"
    exit_with_error(msg)
  # Not found
  return ''


def git_repo_version(repo_path):
  returncode, stdout, stderr = run_get_output([GIT(), 'log', '-n', '1', '--pretty="%aD %H"'], cwd=repo_path)
  if returncode == 0:
    return stdout.strip()
  else:
    return ""


def git_recent_commits(repo_path, n=20):
  returncode, stdout, stderr = run_get_output([GIT(), 'log', '-n', str(n), '--pretty="%H"'], cwd=repo_path)
  if returncode == 0:
    return stdout.strip().replace('\r', '').replace('"', '').split('\n')
  else:
    return []


def git_clone(url, dstpath, branch):
  debug_print('git_clone(url=' + url + ', dstpath=' + dstpath + ')')
  if os.path.isdir(os.path.join(dstpath, '.git')):
    debug_print("Repository '" + url + "' already cloned to directory '" + dstpath + "', skipping.")
    return True
  mkdir_p(dstpath)
  git_clone_args = ['--recurse-submodules', '--branch', branch]  # Do not check out a branch (installer will issue a checkout command right after)
  if GIT_CLONE_SHALLOW:
    git_clone_args += ['--depth', '1']
  print('Cloning from ' + url + '...')
  return run([GIT(), 'clone'] + git_clone_args + [url, dstpath]) == 0


def git_pull(repo_path, branch_or_tag):
  debug_print('git_pull(repo_path=' + repo_path + ', branch/tag=' + branch_or_tag + ')')
  ret = run([GIT(), 'fetch', '--quiet', 'origin'], repo_path)
  if ret != 0:
    return False
  try:
    print("Fetching latest changes to the branch/tag '" + branch_or_tag + "' for '" + repo_path + "'...")
    ret = run([GIT(), 'fetch', '--quiet', 'origin'], repo_path)
    if ret != 0:
      return False
    # this line assumes that the user has not gone and manually messed with the
    # repo and added new remotes to ambiguate the checkout.
    ret = run([GIT(), 'checkout', '--recurse-submodules', '--quiet', branch_or_tag], repo_path)
    if ret != 0:
      return False
    # Test if branch_or_tag is a branch, or if it is a tag that needs to be updated
    target_is_tag = run([GIT(), 'symbolic-ref', '-q', 'HEAD'], repo_path, quiet=True)
    if not target_is_tag:
      # update branch to latest (not needed for tags)
      # this line assumes that the user has not gone and made local changes to the repo
      ret = run([GIT(), 'merge', '--ff-only', 'origin/' + branch_or_tag], repo_path)
    if ret != 0:
      return False
    run([GIT(), 'submodule', 'update', '--init'], repo_path, quiet=True)
  except Exception:
    errlog('git operation failed!')
    return False
  print("Successfully updated and checked out branch/tag '" + branch_or_tag + "' on repository '" + repo_path + "'")
  print("Current repository version: " + git_repo_version(repo_path))
  return True


def git_clone_checkout_and_pull(url, dstpath, branch):
  debug_print('git_clone_checkout_and_pull(url=' + url + ', dstpath=' + dstpath + ', branch=' + branch + ')')

  # If the repository has already been cloned before, issue a pull operation. Otherwise do a new clone.
  if os.path.isdir(os.path.join(dstpath, '.git')):
    return git_pull(dstpath, branch)
  else:
    return git_clone(url, dstpath, branch)


# Each tool can have its own build type, or it can be overridden on the command
# line.
def decide_cmake_build_type(tool):
  if CMAKE_BUILD_TYPE_OVERRIDE:
    return CMAKE_BUILD_TYPE_OVERRIDE
  else:
    return tool.cmake_build_type


# The root directory of the build.
def llvm_build_dir(tool):
  generator_suffix = cmake_generator_prefix()
  bitness_suffix = '_32' if tool.bitness == 32 else '_64'

  if hasattr(tool, 'git_branch'):
    build_dir = 'build_' + tool.git_branch.replace(os.sep, '-') + generator_suffix + bitness_suffix
  else:
    build_dir = 'build_' + tool.version + generator_suffix + bitness_suffix
  return build_dir


def exe_suffix(filename):
  if WINDOWS and not filename.endswith('.exe'):
    filename += '.exe'
  return filename


# The directory where the binaries are produced. (relative to the installation
# root directory of the tool)
def llvm_build_bin_dir(tool):
  build_dir = llvm_build_dir(tool)
  if WINDOWS and 'Visual Studio' in CMAKE_GENERATOR:
    old_llvm_bin_dir = os.path.join(build_dir, 'bin', decide_cmake_build_type(tool))

    new_llvm_bin_dir = None
    default_cmake_build_type = decide_cmake_build_type(tool)
    cmake_build_types = [default_cmake_build_type, 'Release', 'RelWithDebInfo', 'MinSizeRel', 'Debug']
    for build_type in cmake_build_types:
      d = os.path.join(build_dir, build_type, 'bin')
      if os.path.isfile(os.path.join(tool.installation_path(), d, exe_suffix('clang'))):
        new_llvm_bin_dir = d
        break

    if new_llvm_bin_dir and os.path.exists(os.path.join(tool.installation_path(), new_llvm_bin_dir)):
      return new_llvm_bin_dir
    elif os.path.exists(os.path.join(tool.installation_path(), old_llvm_bin_dir)):
      return old_llvm_bin_dir
    return os.path.join(build_dir, default_cmake_build_type, 'bin')
  else:
    return os.path.join(build_dir, 'bin')


def build_env(generator):
  build_env = os.environ.copy()

  # To work around a build issue with older Mac OS X builds, add -stdlib=libc++ to all builds.
  # See https://groups.google.com/forum/#!topic/emscripten-discuss/5Or6QIzkqf0
  if MACOS:
    build_env['CXXFLAGS'] = ((build_env['CXXFLAGS'] + ' ') if hasattr(build_env, 'CXXFLAGS') else '') + '-stdlib=libc++'
  if WINDOWS:
    # MSBuild.exe has an internal mechanism to avoid N^2 oversubscription of threads in its two-tier build model, see
    # https://devblogs.microsoft.com/cppblog/improved-parallelism-in-msbuild/
    build_env['UseMultiToolTask'] = 'true'
    build_env['EnforceProcessCountAcrossBuilds'] = 'true'
  return build_env


def make_build(build_root, build_type):
  debug_print('make_build(build_root=' + build_root + ', build_type=' + build_type + ')')
  if CPU_CORES > 1:
    print('Performing a parallel build with ' + str(CPU_CORES) + ' cores.')
  else:
    print('Performing a singlethreaded build.')

  make = ['cmake', '--build', '.', '--config', build_type]
  if 'Visual Studio' in CMAKE_GENERATOR:
    # Visual Studio historically has had a two-tier problem in its build system design. A single MSBuild.exe instance only governs
    # the build of a single project (.exe/.lib/.dll) in a solution. Passing the -j parameter above will only enable multiple MSBuild.exe
    # instances to be spawned to build multiple projects in parallel, but each MSBuild.exe is still singlethreaded.
    # To enable each MSBuild.exe instance to also compile several .cpp files in parallel inside a single project, pass the extra
    # MSBuild.exe specific "Multi-ToolTask" (MTT) setting /p:CL_MPCount. This enables each MSBuild.exe to parallelize builds wide.
    # This requires CMake 3.12 or newer.
    make += ['-j', str(CPU_CORES), '--', '/p:CL_MPCount=' + str(CPU_CORES)]
  else:
    # Pass -j to native make, CMake might not support -j option.
    make += ['--', '-j', str(CPU_CORES)]

  # Build
  try:
    print('Running build: ' + str(make))
    ret = subprocess.check_call(make, cwd=build_root, env=build_env(CMAKE_GENERATOR))
    if ret != 0:
      errlog('Build failed with exit code ' + ret + '!')
      errlog('Working directory: ' + build_root)
      return False
  except Exception as e:
    errlog('Build failed due to exception!')
    errlog('Working directory: ' + build_root)
    errlog(str(e))
    return False

  return True


def cmake_configure(generator, build_root, src_root, build_type, extra_cmake_args=[]):
  debug_print('cmake_configure(generator=' + str(generator) + ', build_root=' + str(build_root) + ', src_root=' + str(src_root) + ', build_type=' + str(build_type) + ', extra_cmake_args=' + str(extra_cmake_args) + ')')
  # Configure
  if not os.path.isdir(build_root):
    # Create build output directory if it doesn't yet exist.
    os.mkdir(build_root)
  try:
    if generator:
      generator = ['-G', generator]
    else:
      generator = []

    cmdline = ['cmake'] + generator + ['-DCMAKE_BUILD_TYPE=' + build_type, '-DPYTHON_EXECUTABLE=' + sys.executable]
    # Target macOS 11.0 Big Sur at minimum, to support older Mac devices.
    # See https://en.wikipedia.org/wiki/MacOS#Hardware_compatibility for min-spec details.
    cmdline += ['-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0']
    cmdline += extra_cmake_args + [src_root]

    print('Running CMake: ' + str(cmdline))

    # Specify the deployment target also as an env. var, since some Xcode versions
    # read this instead of the CMake field.
    os.environ['MACOSX_DEPLOYMENT_TARGET'] = '11.0'

    def quote_parens(x):
      if ' ' in x:
        return '"' + x.replace('"', '\\"') + '"'
      else:
        return x

    # Create a file 'recmake.bat/sh' in the build root that user can call to
    # manually recmake the build tree with the previous build params
    open(os.path.join(build_root, 'recmake.' + ('bat' if WINDOWS else 'sh')), 'w').write(' '.join(map(quote_parens, cmdline)))
    ret = subprocess.check_call(cmdline, cwd=build_root, env=build_env(CMAKE_GENERATOR))
    if ret != 0:
      errlog('CMake invocation failed with exit code ' + ret + '!')
      errlog('Working directory: ' + build_root)
      return False
  except OSError as e:
    if e.errno == errno.ENOENT:
      errlog(str(e))
      errlog('Could not run CMake, perhaps it has not been installed?')
      if WINDOWS:
        errlog('Installing this package requires CMake. Get it from http://www.cmake.org/')
      elif LINUX:
        errlog('Installing this package requires CMake. Get it via your system package manager (e.g. sudo apt-get install cmake), or from http://www.cmake.org/')
      elif MACOS:
        errlog('Installing this package requires CMake. Get it via a macOS package manager (Homebrew: "brew install cmake", or MacPorts: "sudo port install cmake"), or from http://www.cmake.org/')
      return False
    raise
  except Exception as e:
    errlog('CMake invocation failed due to exception!')
    errlog('Working directory: ' + build_root)
    errlog(str(e))
    return False

  return True


def xcode_sdk_version():
  try:
    output = subprocess.check_output(['xcrun', '--show-sdk-version'])
    if sys.version_info >= (3,):
      output = output.decode('utf8')
    return output.strip().split('.')
  except Exception:
    return subprocess.checkplatform.mac_ver()[0].split('.')


def cmake_target_platform(tool):
  # Source: https://cmake.org/cmake/help/latest/generator/Visual%20Studio%2017%202022.html#platform-selection
  if hasattr(tool, 'arch'):
    if tool.arch == 'arm64':
      return 'ARM64'
    elif tool.arch == 'x86_64':
      return 'x64'
    elif tool.arch == 'x86':
      return 'Win32'
  if ARCH == 'arm64':
    return 'ARM64'
  else:
    return 'x64' if tool.bitness == 64 else 'Win32'


def cmake_host_platform():
  # Source: https://cmake.org/cmake/help/latest/generator/Visual%20Studio%2017%202022.html#toolset-selection
  arch_to_cmake_host_platform = {
    'arm64': 'ARM64',
    'arm': 'ARM',
    'x86_64': 'x64',
    'x86': 'x86'
  }
  return arch_to_cmake_host_platform[ARCH]


def get_generator_and_config_args(tool):
  args = []
  cmake_generator = CMAKE_GENERATOR
  if 'Visual Studio 16' in CMAKE_GENERATOR or 'Visual Studio 17' in CMAKE_GENERATOR:  # VS2019 or VS2022
    # With Visual Studio 16 2019, CMake changed the way they specify target arch.
    # Instead of appending it into the CMake generator line, it is specified
    # with a -A arch parameter.
    args += ['-A', cmake_target_platform(tool)]
    args += ['-Thost=' + cmake_host_platform()]
  elif 'Visual Studio' in CMAKE_GENERATOR and tool.bitness == 64:
    cmake_generator += ' Win64'
    args += ['-Thost=x64']
  return (cmake_generator, args)


def build_llvm(tool):
  debug_print('build_llvm(' + str(tool) + ')')
  llvm_root = tool.installation_path()
  llvm_src_root = os.path.join(llvm_root, 'src')
  success = git_clone_checkout_and_pull(tool.download_url(), llvm_src_root, tool.git_branch)
  if not success:
    return False

  build_dir = llvm_build_dir(tool)
  build_root = os.path.join(llvm_root, build_dir)

  build_type = decide_cmake_build_type(tool)

  # Configure
  tests_arg = 'ON' if BUILD_FOR_TESTING else 'OFF'

  enable_assertions = ENABLE_LLVM_ASSERTIONS.lower() == 'on' or (ENABLE_LLVM_ASSERTIONS == 'auto' and build_type.lower() != 'release' and build_type.lower() != 'minsizerel')

  if ARCH == 'x86' or ARCH == 'x86_64':
    targets_to_build = 'WebAssembly;X86'
  elif ARCH == 'arm':
    targets_to_build = 'WebAssembly;ARM'
  elif ARCH == 'arm64':
    targets_to_build = 'WebAssembly;AArch64'
  else:
    targets_to_build = 'WebAssembly'
  cmake_generator, args = get_generator_and_config_args(tool)
  args += ['-DLLVM_TARGETS_TO_BUILD=' + targets_to_build,
           '-DLLVM_INCLUDE_EXAMPLES=OFF',
           '-DLLVM_INCLUDE_TESTS=' + tests_arg,
           '-DCLANG_INCLUDE_TESTS=' + tests_arg,
           '-DLLVM_ENABLE_ASSERTIONS=' + ('ON' if enable_assertions else 'OFF'),
           # Disable optional LLVM dependencies, these can cause unwanted .so dependencies
           # that prevent distributing the generated compiler for end users.
           '-DLLVM_ENABLE_LIBXML2=OFF', '-DLLVM_ENABLE_TERMINFO=OFF', '-DLLDB_ENABLE_LIBEDIT=OFF',
           '-DLLVM_ENABLE_LIBEDIT=OFF', '-DLLVM_ENABLE_LIBPFM=OFF']
  # LLVM build system bug: compiler-rt does not build on Windows. It insists on performing a CMake install step that writes to C:\Program Files. Attempting
  # to reroute that to build_root directory then fails on an error
  #  file INSTALL cannot find
  #  "C:/code/emsdk/llvm/git/build_master_vs2017_64/$(Configuration)/lib/clang/10.0.0/lib/windows/clang_rt.ubsan_standalone-x86_64.lib".
  # (there instead of $(Configuration), one would need ${CMAKE_BUILD_TYPE} ?)
  # It looks like compiler-rt is not compatible to build on Windows?
  args += ['-DLLVM_ENABLE_PROJECTS=clang;lld']
  # To enable widest possible chance of success for building, let the code
  # compile through with older toolchains that are about to be deprecated by
  # upstream LLVM.
  args += ['-DLLVM_TEMPORARILY_ALLOW_OLD_TOOLCHAIN=ON']

  if os.getenv('LLVM_CMAKE_ARGS'):
    extra_args = os.environ['LLVM_CMAKE_ARGS'].split(',')
    print('Passing the following extra arguments to LLVM CMake configuration: ' + str(extra_args))
    args += extra_args

  cmakelists_dir = os.path.join(llvm_src_root, 'llvm')
  success = cmake_configure(cmake_generator, build_root, cmakelists_dir, build_type, args)
  if not success:
    return False

  # Make
  success = make_build(build_root, build_type)
  return success


def build_ninja(tool):
  debug_print('build_ninja(' + str(tool) + ')')
  root = os.path.normpath(tool.installation_path())
  src_root = os.path.join(root, 'src')
  success = git_clone_checkout_and_pull(tool.download_url(), src_root, tool.git_branch)
  if not success:
    return False

  build_dir = llvm_build_dir(tool)
  build_root = os.path.join(root, build_dir)

  build_type = decide_cmake_build_type(tool)

  # Configure
  cmake_generator, args = get_generator_and_config_args(tool)

  cmakelists_dir = os.path.join(src_root)
  success = cmake_configure(cmake_generator, build_root, cmakelists_dir, build_type, args)
  if not success:
    return False

  # Make
  success = make_build(build_root, build_type)

  if success:
    bin_dir = os.path.join(root, 'bin')
    mkdir_p(bin_dir)
    exe_paths = [os.path.join(build_root, 'Release', 'ninja'), os.path.join(build_root, 'ninja')]
    for e in exe_paths:
      for s in ['.exe', '']:
        ninja = e + s
        if os.path.isfile(ninja):
          dst = os.path.join(bin_dir, 'ninja' + s)
          shutil.copyfile(ninja, dst)
          os.chmod(dst, os.stat(dst).st_mode | stat.S_IEXEC)

  return success


def build_ccache(tool):
  debug_print('build_ccache(' + str(tool) + ')')
  root = os.path.normpath(tool.installation_path())
  src_root = os.path.join(root, 'src')
  success = git_clone_checkout_and_pull(tool.download_url(), src_root, tool.git_branch)
  if not success:
    return False

  build_dir = llvm_build_dir(tool)
  build_root = os.path.join(root, build_dir)

  build_type = decide_cmake_build_type(tool)

  # Configure
  cmake_generator, args = get_generator_and_config_args(tool)
  args += ['-DZSTD_FROM_INTERNET=ON']

  cmakelists_dir = os.path.join(src_root)
  success = cmake_configure(cmake_generator, build_root, cmakelists_dir, build_type, args)
  if not success:
    return False

  # Make
  success = make_build(build_root, build_type)

  if success:
    bin_dir = os.path.join(root, 'bin')
    mkdir_p(bin_dir)
    exe_paths = [os.path.join(build_root, 'Release', 'ccache'), os.path.join(build_root, 'ccache')]
    for e in exe_paths:
      for s in ['.exe', '']:
        ccache = e + s
        if os.path.isfile(ccache):
          dst = os.path.join(bin_dir, 'ccache' + s)
          shutil.copyfile(ccache, dst)
          os.chmod(dst, os.stat(dst).st_mode | stat.S_IEXEC)

    cache_dir = os.path.join(root, 'cache')
    open(os.path.join(root, 'emcc_ccache.conf'), 'w').write('''# Set maximum cache size to 10 GB:
max_size = 10G
cache_dir = %s
''' % cache_dir)
    mkdir_p(cache_dir)

  return success


# Finds the newest installed version of a given tool
def find_latest_installed_tool(name):
  for t in reversed(tools):
    if t.id == name and t.is_installed():
      return t


# npm install in Emscripten root directory
def emscripten_npm_install(tool, directory):
  node_tool = find_latest_installed_tool('node')
  if not node_tool:
    npm_fallback = which('npm')
    if not npm_fallback:
      errlog('Failed to find npm command!')
      errlog('Running "npm ci" in installed Emscripten root directory ' + tool.installation_path() + ' is required!')
      errlog('Please install node.js first!')
      return False
    node_path = os.path.dirname(npm_fallback)
  else:
    node_path = os.path.join(node_tool.installation_path(), 'bin')

  npm = os.path.join(node_path, 'npm' + ('.cmd' if WINDOWS else ''))
  env = os.environ.copy()
  env["PATH"] = node_path + os.pathsep + env["PATH"]
  print('Running post-install step: npm ci ...')
  try:
    subprocess.check_output(
        [npm, 'ci', '--production'],
        cwd=directory, stderr=subprocess.STDOUT, env=env,
        universal_newlines=True)
  except subprocess.CalledProcessError as e:
    errlog('Error running %s:\n%s' % (e.cmd, e.output))
    return False

  print('Done running: npm ci')

  if os.path.isfile(os.path.join(directory, 'bootstrap.py')):
    try:
      subprocess.check_output([sys.executable, os.path.join(directory, 'bootstrap.py')],
                              cwd=directory, stderr=subprocess.STDOUT, env=env,
                              universal_newlines=True)
    except subprocess.CalledProcessError as e:
      errlog('Error running %s:\n%s' % (e.cmd, e.output))
      return False

    print('Done running: Emscripten bootstrap')
  return True


# Binaryen build scripts:
def binaryen_build_root(tool):
  build_root = tool.installation_path().strip()
  if build_root.endswith('/') or build_root.endswith('\\'):
    build_root = build_root[:-1]
  generator_prefix = cmake_generator_prefix()
  build_root = build_root + generator_prefix + '_' + str(tool.bitness) + 'bit_binaryen'
  return build_root


def uninstall_binaryen(tool):
  debug_print('uninstall_binaryen(' + str(tool) + ')')
  build_root = binaryen_build_root(tool)
  print("Deleting path '" + build_root + "'")
  remove_tree(build_root)


def is_binaryen_installed(tool):
  build_root = binaryen_build_root(tool)
  return os.path.exists(build_root)


def build_binaryen_tool(tool):
  debug_print('build_binaryen_tool(' + str(tool) + ')')
  src_root = tool.installation_path()
  build_root = binaryen_build_root(tool)
  build_type = decide_cmake_build_type(tool)

  # Configure
  cmake_generator, args = get_generator_and_config_args(tool)
  args += ['-DENABLE_WERROR=0']  # -Werror is not useful for end users
  args += ['-DBUILD_TESTS=0']  # We don't want to build or run tests

  if 'Visual Studio' in CMAKE_GENERATOR:
    if BUILD_FOR_TESTING:
      args += ['-DRUN_STATIC_ANALYZER=1']

  success = cmake_configure(cmake_generator, build_root, src_root, build_type, args)
  if not success:
    return False

  # Make
  success = make_build(build_root, build_type)

  # Deploy scripts needed from source repository to build directory
  remove_tree(os.path.join(build_root, 'scripts'))
  shutil.copytree(os.path.join(src_root, 'scripts'), os.path.join(build_root, 'scripts'))
  remove_tree(os.path.join(build_root, 'src', 'js'))
  shutil.copytree(os.path.join(src_root, 'src', 'js'), os.path.join(build_root, 'src', 'js'))

  return success


def download_and_extract(archive, dest_dir, filename_prefix='', clobber=True):
  debug_print('download_and_extract(archive=' + archive + ', dest_dir=' + dest_dir + ')')

  url = urljoin(emsdk_packages_url, archive)

  def try_download(url, silent=False):
    return download_file(url, download_dir, not KEEP_DOWNLOADS,
                         filename_prefix, silent=silent)

  # Special hack for the wasm-binaries we transitioned from `.bzip2` to
  # `.xz`, but we can't tell from the version/url which one to use, so
  # try one and then fall back to the other.
  success = False
  if 'wasm-binaries' in archive and os.path.splitext(archive)[1] == '.xz':
    success = try_download(url, silent=True)
    if not success:
      alt_url = url.replace('.tar.xz', '.tbz2')
      success = try_download(alt_url, silent=True)
      if success:
        url = alt_url

  if not success:
    success = try_download(url)

  if not success:
    return False

  # Remove the old directory, since we have some SDKs that install into the
  # same directory.  If we didn't do this contents of the previous install
  # could remain.
  if clobber:
    remove_tree(dest_dir)

  download_target = get_download_target(url, download_dir, filename_prefix)
  if archive.endswith('.zip'):
    return unzip(download_target, dest_dir)
  else:
    return untargz(download_target, dest_dir)


def to_native_path(p):
  if WINDOWS and not MSYS:
    return to_unix_path(p).replace('/', '\\')
  else:
    return to_unix_path(p)


# Finds and returns a list of the directories that need to be added to PATH for
# the given set of tools.
def get_required_path(active_tools):
  path_add = [to_native_path(EMSDK_PATH)]
  for tool in active_tools:
    if hasattr(tool, 'activated_path'):
      path = to_native_path(tool.expand_vars(tool.activated_path))
      # If the tool has an activated_path_skip attribute then we don't add
      # the tools path to the users path if a program by that name is found
      # in the existing PATH.  This allows us to, for example, add our version
      # node to the users PATH if, and only if, they don't already have a
      # another version of node in their PATH.
      if hasattr(tool, 'activated_path_skip'):
        current_path = which(tool.activated_path_skip)
        # We found an executable by this name in the current PATH, but we
        # ignore our own version for this purpose.
        if current_path and os.path.dirname(current_path) != path:
          continue
      path_add.append(path)
  return path_add


# Returns the absolute path to the file '.emscripten' for the current user on
# this system.
EM_CONFIG_PATH = os.path.join(EMSDK_PATH, ".emscripten")
EM_CONFIG_DICT = {}


def parse_key_value(line):
  if not line:
    return ('', '')
  eq = line.find('=')
  if eq != -1:
    key = line[0:eq].strip()
    value = line[eq + 1:].strip()
    return (key, value)
  else:
    return (key, '')


def load_em_config():
  EM_CONFIG_DICT.clear()
  lines = []
  try:
    lines = open(EM_CONFIG_PATH, "r").read().split('\n')
  except Exception:
    pass
  for line in lines:
    try:
      key, value = parse_key_value(line)
      if value != '':
        EM_CONFIG_DICT[key] = value
    except Exception:
      pass


def find_emscripten_root(active_tools):
  """Find the currently active emscripten root.

  If there is more than one tool that defines EMSCRIPTEN_ROOT (this
  should not happen under normal circumstances), assume the last one takes
  precedence.
  """
  root = None
  for tool in active_tools:
    config = tool.activated_config()
    if 'EMSCRIPTEN_ROOT' in config:
      root = config['EMSCRIPTEN_ROOT']
  return root


# returns a tuple (string,string) of config files paths that need to used
# to activate emsdk env depending on $SHELL, defaults to bash.
def get_emsdk_shell_env_configs():
  default_emsdk_env = sdk_path('emsdk_env.sh')
  default_shell_config_file = '$HOME/.bash_profile'
  shell = os.getenv('SHELL', '')
  if 'zsh' in shell:
    return (default_emsdk_env, '$HOME/.zprofile')
  elif 'csh' in shell:
    return (sdk_path('emsdk_env.csh'), '$HOME/.cshrc')
  elif 'fish' in shell:
    return (sdk_path('emsdk_env.fish'), '$HOME/.config/fish/config.fish')
  else:
    return (default_emsdk_env, default_shell_config_file)


def generate_em_config(active_tools, permanently_activate, system):
  cfg = 'import os\n'
  cfg += "emsdk_path = os.path.dirname(os.getenv('EM_CONFIG')).replace('\\\\', '/')\n"

  # Different tools may provide the same activated configs; the latest to be
  # activated is the relevant one.
  activated_config = OrderedDict()
  for tool in active_tools:
    for name, value in tool.activated_config().items():
      activated_config[name] = value

  if 'NODE_JS' not in activated_config:
    node_fallback = which('nodejs')
    if not node_fallback:
      node_fallback = 'node'
    activated_config['NODE_JS'] = node_fallback

  for name, value in activated_config.items():
    cfg += name + " = '" + value + "'\n"

  emroot = find_emscripten_root(active_tools)
  if emroot:
    version = parse_emscripten_version(emroot)
    # Older emscripten versions of emscripten depend on certain config
    # keys that are no longer used.
    # See https://github.com/emscripten-core/emscripten/pull/9469
    if version < [1, 38, 46]:
      cfg += 'COMPILER_ENGINE = NODE_JS\n'
    # See https://github.com/emscripten-core/emscripten/pull/9542
    if version < [1, 38, 48]:
      cfg += 'JS_ENGINES = [NODE_JS]\n'

  cfg = cfg.replace("'" + EMSDK_PATH, "emsdk_path + '")

  if os.path.exists(EM_CONFIG_PATH):
    backup_path = EM_CONFIG_PATH + ".old"
    move_with_overwrite(EM_CONFIG_PATH, backup_path)

  with open(EM_CONFIG_PATH, "w") as text_file:
    text_file.write(cfg)

  # Clear old emscripten content.
  rmfile(os.path.join(EMSDK_PATH, ".emscripten_sanity"))

  path_add = get_required_path(active_tools)

  # Give some recommended next step, depending on the platform
  if WINDOWS:
    if not permanently_activate and not system:
      print('Next steps:')
      print('- Consider running `emsdk activate` with --permanent or --system')
      print('  to have emsdk settings available on startup.')
  else:
    print('Next steps:')
    print('- To conveniently access emsdk tools from the command line,')
    print('  consider adding the following directories to your PATH:')
    for p in path_add:
      print('    ' + p)
    print('- This can be done for the current shell by running:')
    emsdk_env, shell_config_file = get_emsdk_shell_env_configs()
    print('    source "%s"' % emsdk_env)
    print('- Configure emsdk in your shell startup scripts by running:')
    print('    echo \'source "%s"\' >> %s' % (emsdk_env, shell_config_file))


def find_msbuild_dir():
  program_files = os.getenv('ProgramFiles', 'C:/Program Files')
  program_files_x86 = os.getenv('ProgramFiles(x86)', 'C:/Program Files (x86)')
  MSBUILDX86_DIR = os.path.join(program_files_x86, "MSBuild/Microsoft.Cpp/v4.0/Platforms")
  MSBUILD_DIR = os.path.join(program_files, "MSBuild/Microsoft.Cpp/v4.0/Platforms")
  if os.path.exists(MSBUILDX86_DIR):
    return MSBUILDX86_DIR
  if os.path.exists(MSBUILD_DIR):
    return MSBUILD_DIR
  # No MSbuild installed.
  return ''


class Tool(object):
  def __init__(self, data):
    # Convert the dictionary representation of the tool in 'data' to members of
    # this class for convenience.
    for key, value in data.items():
      # Python2 compat, convert unicode to str
      if sys.version_info < (3,) and isinstance(value, unicode): # noqa
        value = value.encode('Latin-1')
      setattr(self, key, value)

    # Cache the name ID of this Tool (these are read very often)
    self.name = self.id
    if self.version:
      self.name += '-' + self.version
    if hasattr(self, 'bitness'):
      self.name += '-' + str(self.bitness) + 'bit'

  def __str__(self):
    return self.name

  def __repr__(self):
    return self.name

  def expand_vars(self, str):
    if WINDOWS and '%MSBuildPlatformsDir%' in str:
      str = str.replace('%MSBuildPlatformsDir%', find_msbuild_dir())
    if '%cmake_build_type_on_win%' in str:
      str = str.replace('%cmake_build_type_on_win%', (decide_cmake_build_type(self) + '/') if WINDOWS else '')
    if '%installation_dir%' in str:
      str = str.replace('%installation_dir%', sdk_path(self.installation_dir()))
    if '%generator_prefix%' in str:
      str = str.replace('%generator_prefix%', cmake_generator_prefix())
    str = str.replace('%.exe%', '.exe' if WINDOWS else '')
    if '%llvm_build_bin_dir%' in str:
      str = str.replace('%llvm_build_bin_dir%', llvm_build_bin_dir(self))

    return str

  # Return true if this tool requires building from source, and false if this is a precompiled tool.
  def needs_compilation(self):
    if hasattr(self, 'cmake_build_type'):
      return True

    if hasattr(self, 'uses'):
      for tool_name in self.uses:
        tool = find_tool(tool_name)
        if not tool:
          debug_print('Tool ' + str(self) + ' depends on ' + tool_name + ' which does not exist!')
          continue
        if tool.needs_compilation():
          return True

    return False

  # Specifies the target path where this tool will be installed to. This could
  # either be a directory or a filename (e.g. in case of node.js)
  def installation_path(self):
    if hasattr(self, 'install_path'):
      pth = self.expand_vars(self.install_path)
      return sdk_path(pth)
    p = self.version
    if hasattr(self, 'bitness') and (not hasattr(self, 'append_bitness') or self.append_bitness):
      p += '_' + str(self.bitness) + 'bit'
    return sdk_path(os.path.join(self.id, p))

  # Specifies the target directory this tool will be installed to.
  def installation_dir(self):
    dir = self.installation_path()
    if path_points_to_directory(dir):
      return dir
    else:
      return os.path.dirname(dir)

  # Returns the configuration item that needs to be added to .emscripten to make
  # this Tool active for the current user.
  def activated_config(self):
    if not hasattr(self, 'activated_cfg'):
      return {}
    config = OrderedDict()
    expanded = to_unix_path(self.expand_vars(self.activated_cfg))
    for specific_cfg in expanded.split(';'):
      name, value = specific_cfg.split('=')
      config[name] = value.strip("'")
    return config

  def activated_environment(self):
    if hasattr(self, 'activated_env'):
      return self.expand_vars(self.activated_env).split(';')
    else:
      return []

  def compatible_with_this_arch(self):
    if hasattr(self, 'arch'):
      if self.arch != ARCH:
        return False
    return True

  def compatible_with_this_os(self):
    if hasattr(self, 'os'):
      if self.os == 'all':
        return True
      if self.compatible_with_this_arch() and ((WINDOWS and 'win' in self.os) or (LINUX and ('linux' in self.os or 'unix' in self.os)) or (MACOS and ('macos' in self.os or 'unix' in self.os))):
        return True
      else:
        return False
    else:
      if not hasattr(self, 'macos_url') and not hasattr(self, 'windows_url') and not hasattr(self, 'unix_url') and not hasattr(self, 'linux_url'):
        return True

    if MACOS and hasattr(self, 'macos_url') and self.compatible_with_this_arch():
      return True

    if LINUX and hasattr(self, 'linux_url') and self.compatible_with_this_arch():
      return True

    if WINDOWS and hasattr(self, 'windows_url') and self.compatible_with_this_arch():
      return True

    if UNIX and hasattr(self, 'unix_url'):
      return True

    return hasattr(self, 'url')

  # the "version file" is a file inside install dirs that indicates the
  # version installed there. this helps disambiguate when there is more than
  # one version that may be installed to the same directory (which is used
  # to avoid accumulating builds over time in some cases, with new builds
  # overwriting the old)
  def get_version_file_path(self):
    return os.path.join(self.installation_path(), '.emsdk_version')

  def is_installed_version(self):
    version_file_path = self.get_version_file_path()
    if os.path.isfile(version_file_path):
      with open(version_file_path, 'r') as version_file:
        return version_file.read().strip() == self.name
    return False

  def update_installed_version(self):
    with open(self.get_version_file_path(), 'w') as version_file:
      version_file.write(self.name + '\n')
    return None

  def is_installed(self, skip_version_check=False):
    # If this tool/sdk depends on other tools, require that all dependencies are
    # installed for this tool to count as being installed.
    if hasattr(self, 'uses'):
      for tool_name in self.uses:
        tool = find_tool(tool_name)
        if tool is None:
          errlog("Manifest error: No tool by name '" + tool_name + "' found! This may indicate an internal SDK error!")
          return False
        if not tool.is_installed():
          return False

    if self.download_url() is None:
      # This tool does not contain downloadable elements, so it is installed by default.
      return True

    content_exists = is_nonempty_directory(self.installation_path())

    # For e.g. fastcomp clang from git repo, the activated PATH is the
    # directory where the compiler is built to, and installation_path is
    # the directory where the source tree exists. To distinguish between
    # multiple packages sharing the same source (clang-main-32bit,
    # clang-main-64bit, clang-main-32bit and clang-main-64bit each
    # share the same git repo), require that in addition to the installation
    # directory, each item in the activated PATH must exist.
    if hasattr(self, 'activated_path') and not os.path.exists(self.expand_vars(self.activated_path)):
      content_exists = False

    if hasattr(self, 'custom_is_installed_script'):
      if self.custom_is_installed_script == 'is_binaryen_installed':
        return is_binaryen_installed(self)
      else:
        raise Exception('Unknown custom_is_installed_script directive "' + self.custom_is_installed_script + '"!')

    return content_exists and (skip_version_check or self.is_installed_version())

  def is_active(self):
    if not self.is_installed():
      return False

    # All dependencies of this tool must be active as well.
    deps = self.dependencies()
    for tool in deps:
      if not tool.is_active():
        return False

    activated_cfg = self.activated_config()
    if not activated_cfg:
      return len(deps) > 0

    for key, value in activated_cfg.items():
      if key not in EM_CONFIG_DICT:
        debug_print(str(self) + ' is not active, because key="' + key + '" does not exist in .emscripten')
        return False

      # all paths are stored dynamically relative to the emsdk root, so
      # normalize those first.
      config_value = EM_CONFIG_DICT[key].replace("emsdk_path + '", "'" + EMSDK_PATH)
      config_value = config_value.strip("'")
      if config_value != value:
        debug_print(str(self) + ' is not active, because key="' + key + '" has value "' + config_value + '" but should have value "' + value + '"')
        return False
    return True

  # Returns true if the system environment variables requires by this tool are currently active.
  def is_env_active(self):
    envs = self.activated_environment()
    for env in envs:
      key, value = parse_key_value(env)
      if key not in os.environ or to_unix_path(os.environ[key]) != to_unix_path(value):
        debug_print(str(self) + ' is not active, because environment variable key="' + key + '" has value "' + str(os.getenv(key)) + '" but should have value "' + value + '"')
        return False

    if hasattr(self, 'activated_path'):
      path = to_unix_path(self.expand_vars(self.activated_path))
      for p in path:
        path_items = os.environ['PATH'].replace('\\', '/').split(ENVPATH_SEPARATOR)
        if not normalized_contains(path_items, p):
          debug_print(str(self) + ' is not active, because environment variable PATH item "' + p + '" is not present (PATH=' + os.environ['PATH'] + ')')
          return False
    return True

  # If this tool can be installed on this system, this function returns True.
  # Otherwise, this function returns a string that describes the reason why this
  # tool is not available.
  def can_be_installed(self):
    if hasattr(self, 'bitness'):
      if self.bitness == 64 and not is_os_64bit():
        return "this tool is only provided for 64-bit OSes"
    return True

  def download_url(self):
    if WINDOWS and hasattr(self, 'windows_url'):
      return self.windows_url
    elif MACOS and hasattr(self, 'macos_url'):
      return self.macos_url
    elif LINUX and hasattr(self, 'linux_url'):
      return self.linux_url
    elif UNIX and hasattr(self, 'unix_url'):
      return self.unix_url
    elif hasattr(self, 'url'):
      return self.url
    else:
      return None

  def install(self):
    """Returns True if the Tool was installed of False if was skipped due to
    already being installed.
    """
    if self.can_be_installed() is not True:
      exit_with_error("The tool '" + str(self) + "' is not available due to the reason: " + self.can_be_installed())

    if self.id == 'sdk':
      return self.install_sdk()
    else:
      return self.install_tool()

  def install_sdk(self):
    """Returns True if any SDK component was installed of False all componented
    were already installed.
    """
    print("Installing SDK '" + str(self) + "'..")
    installed = False

    for tool_name in self.uses:
      tool = find_tool(tool_name)
      if tool is None:
        exit_with_error("manifest error: No tool by name '" + tool_name + "' found! This may indicate an internal SDK error!")
      installed |= tool.install()

    if not installed:
      print("All SDK components already installed: '" + str(self) + "'.")
      return False

    if getattr(self, 'custom_install_script', None) == 'emscripten_npm_install':
      # upstream tools have hardcoded paths that are not stored in emsdk_manifest.json registry
      install_path = 'upstream'
      emscripten_dir = os.path.join(EMSDK_PATH, install_path, 'emscripten')
      # Older versions of the sdk did not include the node_modules directory
      # and require `npm ci` to be run post-install
      if not os.path.exists(os.path.join(emscripten_dir, 'node_modules')):
        if not emscripten_npm_install(self, emscripten_dir):
          exit_with_error('post-install step failed: emscripten_npm_install')

    print("Done installing SDK '" + str(self) + "'.")
    return True

  def install_tool(self):
    """Returns True if the SDK was installed of False if was skipped due to
    already being installed.
    """
    # Avoid doing a redundant reinstall of the tool, if it has already been installed.
    # However all tools that are sourced directly from git branches do need to be
    # installed every time when requested, since the install step is then used to git
    # pull the tool to a newer version.
    if self.is_installed() and not hasattr(self, 'git_branch'):
      print("Skipped installing " + self.name + ", already installed.")
      return False

    print("Installing tool '" + str(self) + "'..")
    url = self.download_url()

    if hasattr(self, 'custom_install_script') and self.custom_install_script == 'build_llvm':
      success = build_llvm(self)
    elif hasattr(self, 'custom_install_script') and self.custom_install_script == 'build_ninja':
      success = build_ninja(self)
    elif hasattr(self, 'custom_install_script') and self.custom_install_script == 'build_ccache':
      success = build_ccache(self)
    elif hasattr(self, 'git_branch'):
      success = git_clone_checkout_and_pull(url, self.installation_path(), self.git_branch)
    elif url.endswith(ARCHIVE_SUFFIXES):
      success = download_and_extract(url, self.installation_path(),
                                     filename_prefix=getattr(self, 'download_prefix', ''))
    else:
      assert False, 'unhandled url type: ' + url

    if not success:
      exit_with_error("installation failed!")

    if hasattr(self, 'custom_install_script'):
      if self.custom_install_script == 'emscripten_npm_install':
        success = emscripten_npm_install(self, self.installation_path())
      elif self.custom_install_script in ('build_llvm', 'build_ninja', 'build_ccache'):
        # 'build_llvm' is a special one that does the download on its
        # own, others do the download manually.
        pass
      elif self.custom_install_script == 'build_binaryen':
        success = build_binaryen_tool(self)
      else:
        raise Exception('Unknown custom_install_script command "' + self.custom_install_script + '"!')

    if not success:
      exit_with_error("installation failed!")

    # Install an emscripten-version.txt file if told to, and if there is one.
    # (If this is not an actual release, but some other build, then we do not
    # write anything.)
    if hasattr(self, 'emscripten_releases_hash'):
      emscripten_version_file_path = os.path.join(to_native_path(self.expand_vars(self.activated_path)), 'emscripten-version.txt')
      version = get_emscripten_release_version(self.emscripten_releases_hash)
      if version:
        with open(emscripten_version_file_path, 'w') as f:
          f.write('"%s"\n' % version)

    print("Done installing tool '" + str(self) + "'.")

    # Sanity check that the installation succeeded, and if so, remove unneeded
    # leftover installation files.
    if not self.is_installed(skip_version_check=True):
      exit_with_error("installation of '" + str(self) + "' failed, but no error was detected. Either something went wrong with the installation, or this may indicate an internal emsdk error.")

    self.cleanup_temp_install_files()
    self.update_installed_version()
    return True

  def cleanup_temp_install_files(self):
    if KEEP_DOWNLOADS:
      return
    url = self.download_url()
    if url.endswith(ARCHIVE_SUFFIXES):
      download_target = get_download_target(url, download_dir, getattr(self, 'download_prefix', ''))
      debug_print("Deleting temporary download: " + download_target)
      rmfile(download_target)

  def uninstall(self):
    if not self.is_installed():
      print("Tool '" + str(self) + "' was not installed. No need to uninstall.")
      return
    print("Uninstalling tool '" + str(self) + "'..")
    if hasattr(self, 'custom_uninstall_script'):
      if self.custom_uninstall_script == 'uninstall_binaryen':
        uninstall_binaryen(self)
      else:
        raise Exception('Unknown custom_uninstall_script directive "' + self.custom_uninstall_script + '"!')
    print("Deleting path '" + self.installation_path() + "'")
    remove_tree(self.installation_path())
    print("Done uninstalling '" + str(self) + "'.")

  def dependencies(self):
    if not hasattr(self, 'uses'):
      return []
    deps = []

    for tool_name in self.uses:
      tool = find_tool(tool_name)
      if tool:
        deps += [tool]
    return deps

  def recursive_dependencies(self):
    if not hasattr(self, 'uses'):
      return []
    deps = []
    for tool_name in self.uses:
      tool = find_tool(tool_name)
      if tool:
        deps += [tool]
        deps += tool.recursive_dependencies()
    return deps


# A global registry of all known Emscripten SDK tools available in the SDK manifest.
tools = []
tools_map = {}


def add_tool(tool):
  tool.is_sdk = False
  tools.append(tool)
  if find_tool(str(tool)):
    raise Exception('Duplicate tool ' + str(tool) + '! Existing:\n{' + ', '.join("%s: %s" % item for item in vars(find_tool(str(tool))).items()) + '}, New:\n{' + ', '.join("%s: %s" % item for item in vars(tool).items()) + '}')
  tools_map[str(tool)] = tool


# A global registry of all known SDK toolsets.
sdks = []
sdks_map = {}


def add_sdk(sdk):
  sdk.is_sdk = True
  sdks.append(sdk)
  if find_sdk(str(sdk)):
    raise Exception('Duplicate sdk ' + str(sdk) + '! Existing:\n{' + ', '.join("%s: %s" % item for item in vars(find_sdk(str(sdk))).items()) + '}, New:\n{' + ', '.join("%s: %s" % item for item in vars(sdk).items()) + '}')
  sdks_map[str(sdk)] = sdk


# N.B. In both tools and sdks list above, we take the convention that the newest
# items are at the back of the list (ascending chronological order)

def find_tool(name):
  return tools_map.get(name)


def find_sdk(name):
  return sdks_map.get(name)


def is_os_64bit():
  return ARCH.endswith('64')


def find_latest_version():
  return resolve_sdk_aliases('latest')


def find_latest_hash():
  version = find_latest_version()
  releases_info = load_releases_info()
  return releases_info['releases'][version]


def resolve_sdk_aliases(name, verbose=False):
  releases_info = load_releases_info()
  while name in releases_info['aliases']:
    if verbose:
      print("Resolving SDK alias '%s' to '%s'" % (name, releases_info['aliases'][name]))
    name = releases_info['aliases'][name]
  return name


def find_latest_sdk():
  return 'sdk-releases-%s-64bit' % (find_latest_hash())


def find_tot_sdk():
  debug_print('Fetching emscripten-releases repository...')
  global extra_release_tag
  extra_release_tag = get_emscripten_releases_tot()
  return 'sdk-releases-%s-64bit' % (extra_release_tag)


def parse_emscripten_version(emscripten_root):
  version_file = os.path.join(emscripten_root, 'emscripten-version.txt')
  with open(version_file) as f:
    version = f.read().strip()
    version = version.strip('"').split('-')[0].split('.')
    return [int(v) for v in version]


# Given a git hash in emscripten-releases, find the emscripten
# version for it. There may not be one if this is not the hash of
# a release, in which case we return None.
def get_emscripten_release_version(emscripten_releases_hash):
  releases_info = load_releases_info()
  for key, value in dict(releases_info['releases']).items():
    if value == emscripten_releases_hash:
      return key.split('-')[0]
  return None


# Get the tip-of-tree build identifier.
def get_emscripten_releases_tot():
  git_clone_checkout_and_pull(emscripten_releases_repo, sdk_path('releases'), 'main')
  recent_releases = git_recent_commits(sdk_path('releases'))
  # The recent releases are the latest hashes in the git repo. There
  # may not be a build for the most recent ones yet; find the last
  # that does.
  arch = ''
  if ARCH == 'arm64':
    arch = '-arm64'

  def make_url(ext):
   return emscripten_releases_download_url_template % (
      os_name(),
      release,
      arch,
      ext,
    )

  for release in recent_releases:
    make_url('tar.xz' if not WINDOWS else 'zip')
    try:
      urlopen(make_url('tar.xz' if not WINDOWS else 'zip'))
    except Exception:
      if not WINDOWS:
        # Try the old `.tbz2` name
        # TODO:remove this once tot builds are all using xz
        try:
          urlopen(make_url('tbz2'))
        except Exception:
          continue
      else:
        continue
    return release
  exit_with_error('failed to find build of any recent emsdk revision')


def get_release_hash(arg, releases_info):
  return releases_info.get(arg, None) or releases_info.get('sdk-' + arg + '-64bit')


def version_key(ver):
  return tuple(map(int, re.split('[._-]', ver)[:3]))


# A sort function that is compatible with both Python 2 and Python 3 using a
# custom comparison function.
def python_2_3_sorted(arr, cmp):
  if sys.version_info >= (3,):
    return sorted(arr, key=functools.cmp_to_key(cmp))
  else:
    return sorted(arr, cmp=cmp)


def is_emsdk_sourced_from_github():
  return os.path.exists(os.path.join(EMSDK_PATH, '.git'))


def update_emsdk():
  if is_emsdk_sourced_from_github():
    errlog('You seem to have bootstrapped Emscripten SDK by cloning from GitHub. In this case, use "git pull" instead of "emsdk update" to update emsdk. (Not doing that automatically in case you have local changes)')
    sys.exit(1)
  if not download_and_extract(emsdk_zip_download_url, EMSDK_PATH, clobber=False):
    sys.exit(1)


# Lists all legacy (pre-emscripten-releases) tagged versions directly in the Git
# repositories. These we can pull and compile from source.
def load_legacy_emscripten_tags():
  return open(sdk_path('legacy-emscripten-tags.txt'), 'r').read().split('\n')


def load_legacy_binaryen_tags():
  return open(sdk_path('legacy-binaryen-tags.txt'), 'r').read().split('\n')


def remove_prefix(s, prefix):
  if s.startswith(prefix):
    return s[len(prefix):]
  else:
    return s


def remove_suffix(s, suffix):
  if s.endswith(suffix):
    return s[:len(s) - len(suffix)]
  else:
    return s


# filename should be one of: 'llvm-precompiled-tags-32bit.txt', 'llvm-precompiled-tags-64bit.txt'
def load_file_index_list(filename):
  items = open(sdk_path(filename)).read().splitlines()
  items = [remove_suffix(remove_suffix(remove_prefix(x, 'emscripten-llvm-e'), '.tar.gz'), '.zip').strip() for x in items]
  items = [x for x in items if 'latest' not in x and len(x) > 0]

  # Sort versions from oldest to newest (the default sort would be
  # lexicographic, i.e. '1.37.1 < 1.37.10 < 1.37.2')
  return sorted(items, key=version_key)


# Load the json info for emscripten-releases.
def load_releases_info():
  if not hasattr(load_releases_info, 'cached_info'):
    try:
      text = open(sdk_path('emscripten-releases-tags.json'), 'r').read()
      load_releases_info.cached_info = json.loads(text)
    except Exception as e:
      print('Error parsing emscripten-releases-tags.json!')
      exit_with_error(str(e))

  return load_releases_info.cached_info


def get_installed_sdk_version():
  version_file = sdk_path(os.path.join('upstream', '.emsdk_version'))
  if not os.path.exists(version_file):
    return None
  with open(version_file) as f:
    version = f.read()
  return version.split('-')[1]


# Get a list of tags for emscripten-releases.
def load_releases_tags():
  tags = []
  info = load_releases_info()

  for version, sha in sorted(info['releases'].items(), key=lambda x: version_key(x[0])):
    tags.append(sha)

  if extra_release_tag:
    tags.append(extra_release_tag)

  # Explicitly add the currently installed SDK version.  This could be a custom
  # version (installed explicitly) so it might not be part of the main list
  # loaded above.
  installed = get_installed_sdk_version()
  if installed and installed not in tags:
    tags.append(installed)

  return tags


def load_releases_versions():
  info = load_releases_info()
  versions = list(info['releases'].keys())
  return versions


def is_string(s):
  if sys.version_info[0] >= 3:
    return isinstance(s, str)
  return isinstance(s, basestring)  # noqa


def load_sdk_manifest():
  try:
    manifest = json.loads(open(sdk_path("emsdk_manifest.json"), "r").read())
  except Exception as e:
    print('Error parsing emsdk_manifest.json!')
    print(str(e))
    return

  emscripten_tags = load_legacy_emscripten_tags()
  llvm_precompiled_tags_32bit = []
  llvm_precompiled_tags_64bit = load_file_index_list('llvm-tags-64bit.txt')
  llvm_precompiled_tags = llvm_precompiled_tags_32bit + llvm_precompiled_tags_64bit
  binaryen_tags = load_legacy_binaryen_tags()
  releases_tags = load_releases_tags()

  def dependencies_exist(sdk):
    for tool_name in sdk.uses:
      tool = find_tool(tool_name)
      if not tool:
        debug_print('missing dependency: ' + tool_name)
        return False
    return True

  def cmp_version(ver, cmp_operand, reference):
    if cmp_operand == '<=':
      return version_key(ver) <= version_key(reference)
    if cmp_operand == '<':
      return version_key(ver) < version_key(reference)
    if cmp_operand == '>=':
      return version_key(ver) >= version_key(reference)
    if cmp_operand == '>':
      return version_key(ver) > version_key(reference)
    if cmp_operand == '==':
      return version_key(ver) == version_key(reference)
    if cmp_operand == '!=':
      return version_key(ver) != version_key(reference)
    raise Exception('Invalid cmp_operand "' + cmp_operand + '"!')

  def passes_filters(param, ver, filters):
    for v in filters:
      if v[0] == param and not cmp_version(ver, v[1], v[2]):
        return False
    return True

  # A 'category parameter' is a %foo%-encoded identifier that specifies
  # a class of tools instead of just one tool, e.g. %tag%
  def expand_category_param(param, category_list, t, is_sdk):
    for i, ver in enumerate(category_list):
      if not ver.strip():
        continue
      t2 = copy.copy(t)
      found_param = False
      for p, v in vars(t2).items():
        if is_string(v) and param in v:
          t2.__dict__[p] = v.replace(param, ver)
          found_param = True
      if not found_param:
        continue
      t2.is_old = i < len(category_list) - 2
      if hasattr(t2, 'uses'):
        t2.uses = [x.replace(param, ver) for x in t2.uses]

      # Filter out expanded tools by version requirements, such as ["tag", "<=", "1.37.22"]
      if hasattr(t2, 'version_filter'):
        passes = passes_filters(param, ver, t2.version_filter)
        if not passes:
          continue

      if is_sdk:
        if dependencies_exist(t2):
          if not find_sdk(t2.name):
            add_sdk(t2)
          else:
            debug_print('SDK ' + str(t2) + ' already existed in manifest, not adding twice')
      else:
        if not find_tool(t2.name):
          add_tool(t2)
        else:
          debug_print('Tool ' + str(t2) + ' already existed in manifest, not adding twice')

  for tool in manifest['tools']:
    t = Tool(tool)
    if t.compatible_with_this_os():
      if not hasattr(t, 'is_old'):
        t.is_old = False

      # Expand the metapackages that refer to tags
      if '%tag%' in t.version:
        expand_category_param('%tag%', emscripten_tags, t, is_sdk=False)
      elif '%precompiled_tag%' in t.version:
        expand_category_param('%precompiled_tag%', llvm_precompiled_tags, t, is_sdk=False)
      elif '%precompiled_tag32%' in t.version:
        expand_category_param('%precompiled_tag32%', llvm_precompiled_tags_32bit, t, is_sdk=False)
      elif '%precompiled_tag64%' in t.version:
        expand_category_param('%precompiled_tag64%', llvm_precompiled_tags_64bit, t, is_sdk=False)
      elif '%binaryen_tag%' in t.version:
        expand_category_param('%binaryen_tag%', binaryen_tags, t, is_sdk=False)
      elif '%releases-tag%' in t.version:
        expand_category_param('%releases-tag%', releases_tags, t, is_sdk=False)
      else:
        add_tool(t)

  for sdk_str in manifest['sdks']:
    sdk_str['id'] = 'sdk'
    sdk = Tool(sdk_str)
    if sdk.compatible_with_this_os():
      if not hasattr(sdk, 'is_old'):
        sdk.is_old = False

      if '%tag%' in sdk.version:
        expand_category_param('%tag%', emscripten_tags, sdk, is_sdk=True)
      elif '%precompiled_tag%' in sdk.version:
        expand_category_param('%precompiled_tag%', llvm_precompiled_tags, sdk, is_sdk=True)
      elif '%precompiled_tag32%' in sdk.version:
        expand_category_param('%precompiled_tag32%', llvm_precompiled_tags_32bit, sdk, is_sdk=True)
      elif '%precompiled_tag64%' in sdk.version:
        expand_category_param('%precompiled_tag64%', llvm_precompiled_tags_64bit, sdk, is_sdk=True)
      elif '%releases-tag%' in sdk.version:
        expand_category_param('%releases-tag%', releases_tags, sdk, is_sdk=True)
      else:
        add_sdk(sdk)


# Tests if the two given tools can be active at the same time.
# Currently only a simple check for name for same tool with different versions,
# possibly adds more logic in the future.
def can_simultaneously_activate(tool1, tool2):
  return tool1.id != tool2.id


# Expands dependencies for each tool, and removes ones that don't exist.
def process_tool_list(tools_to_activate):
  i = 0
  # Gather dependencies for each tool
  while i < len(tools_to_activate):
    tool = tools_to_activate[i]
    deps = tool.recursive_dependencies()
    tools_to_activate = tools_to_activate[:i] + deps + tools_to_activate[i:]
    i += len(deps) + 1

  for tool in tools_to_activate:
    if not tool.is_installed():
      exit_with_error("error: tool is not installed and therefore cannot be activated: '%s'" % tool)

  # Remove conflicting tools
  i = 0
  while i < len(tools_to_activate):
    j = 0
    while j < i:
      secondary_tool = tools_to_activate[j]
      primary_tool = tools_to_activate[i]
      if not can_simultaneously_activate(primary_tool, secondary_tool):
        tools_to_activate.pop(j)
        j -= 1
        i -= 1
      j += 1
    i += 1
  return tools_to_activate


def write_set_env_script(env_string):
  assert CMD or POWERSHELL
  open(EMSDK_SET_ENV, 'w').write(env_string)


# Reconfigure .emscripten to choose the currently activated toolset, set PATH
# and other environment variables.
# Returns the full list of deduced tools that are now active.
def set_active_tools(tools_to_activate, permanently_activate, system):
  tools_to_activate = process_tool_list(tools_to_activate)

  if tools_to_activate:
    tools = [x for x in tools_to_activate if not x.is_sdk]
    print('Setting the following tools as active:\n   ' + '\n   '.join(map(lambda x: str(x), tools)))
    print('')

  generate_em_config(tools_to_activate, permanently_activate, system)

  # Construct a .bat or .ps1 script that will be invoked to set env. vars and PATH
  # We only do this on cmd or powershell since emsdk.bat/ps1 is able to modify the
  # calling shell environment.  On other shell `source emsdk_env.sh` is
  # required.
  if CMD or POWERSHELL:
    # always set local environment variables since permanently activating will only set the registry settings and
    # will not affect the current session
    env_vars_to_add = get_env_vars_to_add(tools_to_activate, system, user=permanently_activate)
    env_string = construct_env_with_vars(env_vars_to_add)
    write_set_env_script(env_string)

    if WINDOWS and permanently_activate:
      win_set_environment_variables(env_vars_to_add, system, user=permanently_activate)

  return tools_to_activate


def currently_active_sdk():
  for sdk in reversed(sdks):
    if sdk.is_active():
      return sdk
  return None


def currently_active_tools():
  active_tools = []
  for tool in tools:
    if tool.is_active():
      active_tools += [tool]
  return active_tools


# http://stackoverflow.com/questions/480214/how-do-you-remove-duplicates-from-a-list-in-python-whilst-preserving-order
def unique_items(seq):
  seen = set()
  seen_add = seen.add
  return [x for x in seq if x not in seen and not seen_add(x)]


# Tests if a path is contained in the given list, but with separators normalized.
def normalized_contains(lst, elem):
  elem = to_unix_path(elem)
  for e in lst:
    if elem == to_unix_path(e):
      return True
  return False


def to_msys_path(p):
  p = to_unix_path(p)
  new_path = re.sub(r'([a-zA-Z]):/(.*)', r'/\1/\2', p)
  if len(new_path) > 3 and new_path[0] == '/' and new_path[2] == '/':
    new_path = new_path[0] + new_path[1].lower() + new_path[2:]
  return new_path


# Looks at the current PATH and adds and removes entries so that the PATH reflects
# the set of given active tools.
def adjusted_path(tools_to_activate, system=False, user=False):
  # These directories should be added to PATH
  path_add = get_required_path(tools_to_activate)
  # These already exist.
  if WINDOWS and not MSYS:
    existing_path = win_get_environment_variable('PATH', system=system, user=user, fallback=True).split(ENVPATH_SEPARATOR)
  else:
    existing_path = os.environ['PATH'].split(ENVPATH_SEPARATOR)

  existing_emsdk_tools = []
  existing_nonemsdk_path = []
  for entry in existing_path:
    if to_unix_path(entry).startswith(EMSDK_PATH):
      existing_emsdk_tools.append(entry)
    else:
      existing_nonemsdk_path.append(entry)

  new_emsdk_tools = []
  kept_emsdk_tools = []
  for entry in path_add:
    if not normalized_contains(existing_emsdk_tools, entry):
      new_emsdk_tools.append(entry)
    else:
      kept_emsdk_tools.append(entry)

  whole_path = unique_items(new_emsdk_tools + kept_emsdk_tools + existing_nonemsdk_path)

  if MSYS:
    # XXX Hack: If running native Windows Python in MSYS prompt where PATH
    # entries look like "/c/Windows/System32", os.environ['PATH']
    # in Python will transform to show them as "C:\\Windows\\System32", so need
    # to reconvert path delimiter back to forward slashes.
    whole_path = [to_msys_path(p) for p in whole_path]
    new_emsdk_tools = [to_msys_path(p) for p in new_emsdk_tools]

  separator = ':' if MSYS else ENVPATH_SEPARATOR
  return (separator.join(whole_path), new_emsdk_tools)


def get_env_vars_to_add(tools_to_activate, system, user):
  env_vars_to_add = []

  newpath, added_path = adjusted_path(tools_to_activate, system, user)

  # Don't bother setting the path if there are no changes.
  if os.environ['PATH'] != newpath:
    env_vars_to_add += [('PATH', newpath)]

    if added_path:
      info('Adding directories to PATH:')
      for item in added_path:
        info('PATH += ' + item)
      info('')

  # A core variable EMSDK points to the root of Emscripten SDK directory.
  env_vars_to_add += [('EMSDK', EMSDK_PATH)]

  for tool in tools_to_activate:
    for env in tool.activated_environment():
      key, value = parse_key_value(env)
      value = to_native_path(tool.expand_vars(value))
      env_vars_to_add += [(key, value)]

  emroot = find_emscripten_root(tools_to_activate)
  if emroot:
    # For older emscripten versions that don't use an embedded cache by
    # default we need to export EM_CACHE.
    #
    # Sadly, we can't put this in the config file since those older versions
    # also didn't read the `CACHE` key from the config file:
    #
    # History:
    # - 'CACHE' config started being honored in 1.39.16
    #   https://github.com/emscripten-core/emscripten/pull/11091
    # - Default to embedded cache also started in 1.39.16
    #   https://github.com/emscripten-core/emscripten/pull/11126
    # - Emscripten supports automatically locating the embedded
    #   config in 1.39.13:
    #   https://github.com/emscripten-core/emscripten/pull/10935
    #
    # Since setting EM_CACHE in the environment effects the entire machine
    # we want to avoid this except when installing these older emscripten
    # versions that really need it.
    version = parse_emscripten_version(emroot)
    if version < [1, 39, 16]:
      em_cache_dir = os.path.join(emroot, 'cache')
      env_vars_to_add += [('EM_CACHE', em_cache_dir)]
    if version < [1, 39, 13]:
      env_vars_to_add += [('EM_CONFIG', os.path.normpath(EM_CONFIG_PATH))]

  return env_vars_to_add


def construct_env(tools_to_activate, system, user):
  info('Setting up EMSDK environment (suppress these messages with EMSDK_QUIET=1)')
  return construct_env_with_vars(get_env_vars_to_add(tools_to_activate, system, user))


def unset_env(key):
  if POWERSHELL:
    return 'Remove-Item env:%s\n' % key
  if CMD:
    return 'set %s=\n' % key
  if CSH:
    return 'unsetenv %s;\n' % key
  if FISH:
    return 'set -e %s;\n' % key
  if BASH:
    return 'unset %s;\n' % key
  assert False


def construct_env_with_vars(env_vars_to_add):
  env_string = ''
  if env_vars_to_add:
    info('Setting environment variables:')

    for key, value in env_vars_to_add:
      # Don't set env vars which are already set to the correct value.
      if key in os.environ and to_unix_path(os.environ[key]) == to_unix_path(value):
        continue
      info(key + ' = ' + value)
      if POWERSHELL:
        env_string += '$env:' + key + '="' + value + '"\n'
      elif CMD:
        env_string += 'SET ' + key + '=' + value + '\n'
      elif CSH:
        env_string += 'setenv ' + key + ' "' + value + '";\n'
      elif FISH:
        env_string += 'set -gx ' + key + ' "' + value + '";\n'
      elif BASH:
        env_string += 'export ' + key + '="' + value + '";\n'
      else:
        assert False

    if 'EMSDK_PYTHON' in env_vars_to_add:
      # When using our bundled python we never want the user's
      # PYTHONHOME or PYTHONPATH
      # See https://github.com/emscripten-core/emsdk/issues/598
      env_string += unset_env('PYTHONHOME')
      env_string += unset_env('PYTHONPATH')

  # Remove any environment variables that might have been set by old or
  # inactive tools/sdks.  For example, we set EM_CACHE for older versions
  # of the SDK but we want to remove that from the current environment
  # if no such tool is active.
  # Ignore certain keys that are inputs to emsdk itself.
  ignore_keys = set(['EMSDK_POWERSHELL', 'EMSDK_CSH', 'EMSDK_CMD', 'EMSDK_BASH', 'EMSDK_FISH',
                     'EMSDK_NUM_CORES', 'EMSDK_NOTTY', 'EMSDK_KEEP_DOWNLOADS'])
  env_keys_to_add = set(pair[0] for pair in env_vars_to_add)
  for key in os.environ:
    if key.startswith('EMSDK_') or key in ('EM_CACHE', 'EM_CONFIG'):
      if key not in env_keys_to_add and key not in ignore_keys:
        info('Clearing existing environment variable: %s' % key)
        env_string += unset_env(key)

  return env_string


def error_on_missing_tool(name):
  if name.endswith('-64bit') and not is_os_64bit():
    exit_with_error("'%s' is only provided for 64-bit OSes" % name)
  else:
    exit_with_error("tool or SDK not found: '%s'" % name)


def expand_sdk_name(name, activating):
  if 'upstream-master' in name:
    errlog('upstream-master SDK has been renamed main')
    name = name.replace('upstream-master', 'main')
  if 'fastcomp' in name:
    exit_with_error('the fastcomp backend is no longer supported.  Please use an older version of emsdk (for example 3.1.29) if you want to install the old fastcomp-based SDK')
  if name in ('tot', 'sdk-tot', 'tot-upstream'):
    if activating:
      # When we are activating a tot release, assume that the currently
      # installed SDK, if any, is the tot release we want to activate.
      # Without this `install tot && activate tot` will race with the builders
      # that are producing new builds.
      installed = get_installed_sdk_version()
      if installed:
        debug_print('activating currently installed SDK; not updating tot version')
        return 'sdk-releases-%s-64bit' % installed
    return find_tot_sdk()

  if '-upstream' in name:
    name = name.replace('-upstream', '')

  name = resolve_sdk_aliases(name, verbose=True)

  # check if it's a release handled by an emscripten-releases version,
  # and if so use that by using the right hash. we support a few notations,
  #   x.y.z
  #   sdk-x.y.z-64bit
  # TODO: support short notation for old builds too?
  fullname = name
  version = fullname.replace('sdk-', '').replace('releases-', '').replace('-64bit', '').replace('tag-', '')
  sdk = 'sdk-' if not name.startswith('releases-') else ''
  releases_info = load_releases_info()['releases']
  release_hash = get_release_hash(version, releases_info)
  if release_hash:
    # Known release hash
    full_name = '%sreleases-%s-64bit' % (sdk, release_hash)
    print("Resolving SDK version '%s' to '%s'" % (version, full_name))
    return full_name

  if len(version) == 40:
    global extra_release_tag
    extra_release_tag = version
    return '%sreleases-%s-64bit' % (sdk, version)

  return name


def main(args):
  if not args:
    errlog("Missing command; Type 'emsdk help' to get a list of commands.")
    return 1

  debug_print('emsdk.py running under `%s`' % sys.executable)
  cmd = args.pop(0)

  if cmd in ('help', '--help', '-h'):
    print(' emsdk: Available commands:')

    print('''
   emsdk list [--old] [--uses]  - Lists all available SDKs and tools and their
                                  current installation status. With the --old
                                  parameter, also historical versions are
                                  shown. If --uses is passed, displays the
                                  composition of different SDK packages and
                                  dependencies.

   emsdk update                 - Updates emsdk to the newest version. If you have
                                  bootstrapped emsdk via cloning directly from
                                  GitHub, call "git pull" instead to update emsdk.

   emsdk install [options] <tool 1> <tool 2> <tool 3> ...
                                - Downloads and installs given tools or SDKs.
                                  Options can contain:

                         -j<num>: Specifies the number of cores to use when
                                  building the tool. Default: use one less
                                  than the # of detected cores.

                  --build=<type>: Controls what kind of build of LLVM to
                                  perform. Pass either 'Debug', 'Release',
                                  'MinSizeRel' or 'RelWithDebInfo'. Default:
                                  'Release'.

              --generator=<type>: Specifies the CMake Generator to be used
                                  during the build. Possible values are the
                                  same as what your CMake supports and whether
                                  the generator is valid depends on the tools
                                  you have installed. Defaults to 'Unix Makefiles'
                                  on *nix systems. If generator name is multiple
                                  words, enclose with single or double quotes.

                       --shallow: When installing tools from one of the git
                                  development branches, this parameter can be
                                  passed to perform a shallow git clone instead
                                  of a full one.  This reduces the amount of
                                  network transfer that is needed. This option
                                  should only be used when you are interested in
                                  downloading one of the development branches,
                                  but are not looking to develop Emscripten
                                  yourself.  Default: disabled, i.e. do a full
                                  clone.

                   --build-tests: If enabled, LLVM is built with internal tests
                                  included. Pass this to enable running test
                                  other.test_llvm_lit in the Emscripten test
                                  suite. Default: disabled.
             --enable-assertions: If specified, LLVM is built with assert()
                                  checks enabled. Useful for development
                                  purposes. Default: Enabled
            --disable-assertions: Forces assertions off during the build.

               --vs2019/--vs2022: If building from source, overrides to build
                                  using the specified compiler. When installing
                                  precompiled packages, this has no effect.
                                  Note: The same compiler specifier must be
                                  passed to the emsdk activate command to
                                  activate the desired version.

                                  Notes on building from source:

                                  To pass custom CMake directives when configuring
                                  LLVM build, specify the environment variable
                                  LLVM_CMAKE_ARGS="param1=value1,param2=value2"
                                  in the environment where the build is invoked.
                                  See README.md for details.

           --override-repository: Specifies the git URL to use for a given Tool. E.g.
                                  --override-repository emscripten-main@https://github.com/<fork>/emscripten/tree/<refspec>


   emsdk uninstall <tool/sdk>   - Removes the given tool or SDK from disk.''')

    if WINDOWS:
      print('''
   emsdk activate [--permanent] [--system] [--build=type] [--vs2019/--vs2022] <tool/sdk>

                                - Activates the given tool or SDK in the
                                  environment of the current shell.

                                - If the `--permanent` option is passed, then the environment
                                  variables are set permanently for the current user.

                                - If the `--system` option is passed, the registration
                                  is done for all users of the system.
                                  This needs admin privileges
                                  (uses Machine environment variables).

                                - If a custom compiler version was used to override
                                  the compiler to use, pass the same --vs2019/--vs2022
                                  parameter here to choose which version to activate.

   emcmdprompt.bat              - Spawns a new command prompt window with the
                                  Emscripten environment active.''')
    else:
      print('''   emsdk activate [--build=type] <tool/sdk>

                                - Activates the given tool or SDK in the
                                  environment of the current shell.''')

    print('''
       Both commands 'install' and 'activate' accept an optional parameter
       '--build=type', which can be used to override what kind of installation
       or activation to perform. Possible values for type are Debug, Release,
       MinSizeRel or RelWithDebInfo. Note: When overriding a custom build type,
       be sure to match the same --build= option to both 'install' and
       'activate' commands and the invocation of 'emsdk_env', or otherwise
       these commands will default to operating on the default build type
       which is RelWithDebInfo.''')

    print('''

   Environment:
      EMSDK_KEEP_DOWNLOADS=1     - if you want to keep the downloaded archives.
      EMSDK_NOTTY=1              - override isatty() result (mainly to log progress).
      EMSDK_NUM_CORES=n          - limit parallelism to n cores.
      EMSDK_VERBOSE=1            - very verbose output, useful for debugging.''')
    return 0

  # Extracts a boolean command line argument from args and returns True if it was present
  def extract_bool_arg(name):
    if name in args:
      args.remove(name)
      return True
    return False

  def extract_string_arg(name):
    for i in range(len(args)):
      if args[i] == name:
        value = args[i + 1]
        del args[i:i + 2]
        return value

  arg_old = extract_bool_arg('--old')
  arg_uses = extract_bool_arg('--uses')
  arg_permanent = extract_bool_arg('--permanent')
  arg_global = extract_bool_arg('--global')
  arg_system = extract_bool_arg('--system')
  if arg_global:
    print('--global is deprecated. Use `--system` to set the environment variables for all users')
    arg_system = True
  if arg_system:
    arg_permanent = True
  if extract_bool_arg('--embedded'):
    errlog('embedded mode is now the only mode available')
  if extract_bool_arg('--no-embedded'):
    errlog('embedded mode is now the only mode available')
    return 1

  arg_notty = extract_bool_arg('--notty')
  if arg_notty:
    global TTY_OUTPUT
    TTY_OUTPUT = False

  # Replace meta-packages with the real package names.
  if cmd in ('update', 'install', 'activate'):
    activating = cmd == 'activate'
    args = [expand_sdk_name(a, activating=activating) for a in args]

  load_em_config()
  load_sdk_manifest()

  # Apply any overrides to git branch names to clone from.
  forked_url = extract_string_arg('--override-repository')
  while forked_url:
    tool_name, url_and_refspec = forked_url.split('@')
    t = find_tool(tool_name)
    if not t:
      errlog('Failed to find tool ' + tool_name + '!')
      return False
    else:
      t.url, t.git_branch = parse_github_url_and_refspec(url_and_refspec)
      debug_print('Reading git repository URL "' + t.url + '" and git branch "' + t.git_branch + '" for Tool "' + tool_name + '".')

    forked_url = extract_string_arg('--override-repository')

  # Process global args
  for i in range(len(args)):
    if args[i].startswith('--generator='):
      build_generator = re.match(r'''^--generator=['"]?([^'"]+)['"]?$''', args[i])
      if build_generator:
        global CMAKE_GENERATOR
        CMAKE_GENERATOR = build_generator.group(1)
        args[i] = ''
      else:
        errlog("Cannot parse CMake generator string: " + args[i] + ". Try wrapping generator string with quotes")
        return 1
    elif args[i].startswith('--build='):
      build_type = re.match(r'^--build=(.+)$', args[i])
      if build_type:
        global CMAKE_BUILD_TYPE_OVERRIDE
        build_type = build_type.group(1)
        build_types = ['Debug', 'MinSizeRel', 'RelWithDebInfo', 'Release']
        try:
          build_type_index = [x.lower() for x in build_types].index(build_type.lower())
          CMAKE_BUILD_TYPE_OVERRIDE = build_types[build_type_index]
          args[i] = ''
        except Exception:
          errlog('Unknown CMake build type "' + build_type + '" specified! Please specify one of ' + str(build_types))
          return 1
      else:
        errlog("Invalid command line parameter " + args[i] + ' specified!')
        return 1
  args = [x for x in args if x]

  if cmd == 'list':
    print('')

    def installed_sdk_text(name):
      sdk = find_sdk(name)
      return 'INSTALLED' if sdk and sdk.is_installed() else ''

    if (LINUX or MACOS or WINDOWS) and (ARCH == 'x86' or ARCH == 'x86_64'):
      print('The *recommended* precompiled SDK download is %s (%s).' % (find_latest_version(), find_latest_hash()))
      print()
      print('To install/activate it use:')
      print('         latest')
      print('')
      print('This is equivalent to installing/activating:')
      print('         %s             %s' % (find_latest_version(), installed_sdk_text(find_latest_sdk())))
      print('')
    else:
      print('Warning: your platform does not have precompiled SDKs available.')
      print('You may install components from source.')
      print('')

    print('All recent (non-legacy) installable versions are:')
    releases_versions = sorted(load_releases_versions(), key=version_key, reverse=True)
    releases_info = load_releases_info()['releases']
    for ver in releases_versions:
      print('         %s    %s' % (ver, installed_sdk_text('sdk-releases-%s-64bit' % get_release_hash(ver, releases_info))))
    print()

    # Use array to work around the lack of being able to mutate from enclosing
    # function.
    has_partially_active_tools = [False]

    if sdks:
      def find_sdks(needs_compilation):
        s = []
        for sdk in sdks:
          if sdk.is_old and not arg_old:
            continue
          if sdk.needs_compilation() == needs_compilation:
            s += [sdk]
        return s

      def print_sdks(s):
        for sdk in s:
          installed = '\tINSTALLED' if sdk.is_installed() else ''
          active = '*' if sdk.is_active() else ' '
          print('    ' + active + '    {0: <25}'.format(str(sdk)) + installed)
          if arg_uses:
            for dep in sdk.uses:
              print('          - {0: <25}'.format(dep))
        print('')
      print('The additional following precompiled SDKs are also available for download:')
      print_sdks(find_sdks(False))

      print('The following SDKs can be compiled from source:')
      print_sdks(find_sdks(True))

    if tools:
      def find_tools(needs_compilation):
        t = []
        for tool in tools:
          if tool.is_old and not arg_old:
            continue
          if tool.needs_compilation() != needs_compilation:
            continue
          t += [tool]
        return t

      def print_tools(t):
        for tool in t:
          if tool.is_old and not arg_old:
            continue
          if tool.can_be_installed() is True:
            installed = '\tINSTALLED' if tool.is_installed() else ''
          else:
            installed = '\tNot available: ' + tool.can_be_installed()
          tool_is_active = tool.is_active()
          tool_is_env_active = tool_is_active and tool.is_env_active()
          if tool_is_env_active:
            active = ' * '
          elif tool_is_active:
            active = '(*)'
            has_partially_active_tools[0] = has_partially_active_tools[0] or True
          else:
            active = '   '
          print('    ' + active + '    {0: <25}'.format(str(tool)) + installed)
        print('')

      print('The following precompiled tool packages are available for download:')
      print_tools(find_tools(needs_compilation=False))
      print('The following tools can be compiled from source:')
      print_tools(find_tools(needs_compilation=True))
    else:
      if is_emsdk_sourced_from_github():
        print("There are no tools available. Run 'git pull' to fetch the latest set of tools.")
      else:
        print("There are no tools available. Run 'emsdk update' to fetch the latest set of tools.")
      print('')

    print('Items marked with * are activated for the current user.')
    if has_partially_active_tools[0]:
      env_cmd = 'emsdk_env.bat' if WINDOWS else 'source ./emsdk_env.sh'
      print('Items marked with (*) are selected for use, but your current shell environment is not configured to use them. Type "' + env_cmd + '" to set up your current shell to use them' + (', or call "emsdk activate --permanent <name_of_sdk>" to permanently activate them.' if WINDOWS else '.'))
    if not arg_old:
      print('')
      print("To access the historical archived versions, type 'emsdk list --old'")

    print('')
    if is_emsdk_sourced_from_github():
      print('Run "git pull" to pull in the latest list.')
    else:
      print('Run "./emsdk update" to pull in the latest list.')

    return 0
  elif cmd == 'construct_env':
    # Clean up old temp file up front, in case of failure later before we get
    # to write out the new one.
    tools_to_activate = currently_active_tools()
    tools_to_activate = process_tool_list(tools_to_activate)
    env_string = construct_env(tools_to_activate, arg_system, arg_permanent)
    if CMD or POWERSHELL:
      write_set_env_script(env_string)
    else:
      sys.stdout.write(env_string)
    return 0
  elif cmd == 'update':
    update_emsdk()
    if WINDOWS:
      # Clean up litter after old emsdk update which may have left this temp
      # file around.
      rmfile(sdk_path(EMSDK_SET_ENV))
    return 0
  elif cmd == 'update-tags':
    errlog('`update-tags` is not longer needed.  To install the latest tot release just run `install tot`')
    return 0
  elif cmd == 'activate':
    if arg_permanent:
      print('Registering active Emscripten environment permanently')
      print('')

    tools_to_activate = currently_active_tools()
    for arg in args:
      tool = find_tool(arg)
      if tool is None:
        tool = find_sdk(arg)
        if tool is None:
          error_on_missing_tool(arg)
      tools_to_activate += [tool]
    if not tools_to_activate:
      errlog('No tools/SDKs specified to activate! Usage:\n   emsdk activate tool/sdk1 [tool/sdk2] [...]')
      return 1
    active_tools = set_active_tools(tools_to_activate, permanently_activate=arg_permanent, system=arg_system)
    if not active_tools:
      errlog('No tools/SDKs found to activate! Usage:\n   emsdk activate tool/sdk1 [tool/sdk2] [...]')
      return 1
    if WINDOWS and not arg_permanent:
      errlog('The changes made to environment variables only apply to the currently running shell instance. Use the \'emsdk_env.bat\' to re-enter this environment later, or if you\'d like to register this environment permanently, rerun this command with the option --permanent.')
    return 0
  elif cmd == 'install':
    global BUILD_FOR_TESTING, ENABLE_LLVM_ASSERTIONS, CPU_CORES, GIT_CLONE_SHALLOW

    # Process args
    for i in range(len(args)):
      if args[i].startswith('-j'):
        multicore = re.match(r'^-j(\d+)$', args[i])
        if multicore:
          CPU_CORES = int(multicore.group(1))
          args[i] = ''
        else:
          errlog("Invalid command line parameter " + args[i] + ' specified!')
          return 1
      elif args[i] == '--shallow':
        GIT_CLONE_SHALLOW = True
        args[i] = ''
      elif args[i] == '--build-tests':
        BUILD_FOR_TESTING = True
        args[i] = ''
      elif args[i] == '--enable-assertions':
        ENABLE_LLVM_ASSERTIONS = 'ON'
        args[i] = ''
      elif args[i] == '--disable-assertions':
        ENABLE_LLVM_ASSERTIONS = 'OFF'
        args[i] = ''
    args = [x for x in args if x]
    if not args:
      errlog("Missing parameter. Type 'emsdk install <tool name>' to install a tool or an SDK. Type 'emsdk list' to obtain a list of available tools. Type 'emsdk install latest' to automatically install the newest version of the SDK.")
      return 1

    if LINUX and ARCH == 'arm64' and args != ['latest']:
      errlog('WARNING: arm64-linux binaries are not available for all releases.')
      errlog('See https://github.com/emscripten-core/emsdk/issues/547')

    for t in args:
      tool = find_tool(t)
      if tool is None:
        tool = find_sdk(t)
      if tool is None:
        error_on_missing_tool(t)
      tool.install()
    return 0
  elif cmd == 'uninstall':
    if not args:
      errlog("Syntax error. Call 'emsdk uninstall <tool name>'. Call 'emsdk list' to obtain a list of available tools.")
      return 1
    tool = find_tool(args[0])
    if tool is None:
      errlog("Error: Tool by name '" + args[0] + "' was not found.")
      return 1
    tool.uninstall()
    return 0

  errlog("Unknown command '" + cmd + "' given! Type 'emsdk help' to get a list of commands.")
  return 1


if __name__ == '__main__':
  try:
    sys.exit(main(sys.argv[1:]))
  except KeyboardInterrupt:
    exit_with_error('aborted by user, exiting')
    sys.exit(1)
