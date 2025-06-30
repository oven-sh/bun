#!/usr/bin/env python3

import argparse
import json
import os
import re
import subprocess
import sys
from collections import OrderedDict

script_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(script_dir)
sys.path.append(root_dir)

import emsdk  # noqa


def version_key(version_string):
  parts = re.split('[.-]', version_string)
  key = [[int(part) for part in parts[:3]], -len(parts), parts[3:]]
  return key


def main():
  if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root_dir).strip():
    print('tree is not clean')
    sys.exit(1)

  parser = argparse.ArgumentParser()
  parser.add_argument('-r', '--release-hash')
  parser.add_argument('-a', '--asserts-hash')
  parser.add_argument('-v', '--new-version')
  parser.add_argument('--gh-action', action='store_true')
  options = parser.parse_args()

  release_info = emsdk.load_releases_info()
  if options.new_version:
    new_version = options.new_version
  else:
    new_version = version_key(release_info['aliases']['latest'])[0]
    new_version[-1] += 1
    new_version = '.'.join(str(part) for part in new_version)

  asserts_hash = None
  if options.release_hash:
    new_hash = options.release_hash
    asserts_hash = options.asserts_hash
  else:
    new_hash = emsdk.get_emscripten_releases_tot()

  print('Creating new release: %s -> %s' % (new_version, new_hash))
  release_info['releases'][new_version] = new_hash
  if asserts_hash:
    asserts_name = new_version + '-asserts'
    release_info['releases'][asserts_name] = asserts_hash

  releases = [(k, v) for k, v in release_info['releases'].items()]
  releases.sort(key=lambda pair: version_key(pair[0]))

  release_info['releases'] = OrderedDict(reversed(releases))
  release_info['aliases']['latest'] = new_version

  with open(os.path.join(root_dir, 'emscripten-releases-tags.json'), 'w') as f:
    f.write(json.dumps(release_info, indent=2))
    f.write('\n')

  subprocess.check_call(
    [sys.executable, os.path.join(script_dir, 'update_bazel_workspace.py')],
    cwd=root_dir)

  branch_name = 'version_' + new_version

  if options.gh_action:  # For GitHub Actions workflows
    with open(os.environ['GITHUB_ENV'], 'a') as f:
      f.write(f'RELEASE_VERSION={new_version}')
  else:  # Local use
    # Create a new git branch
    subprocess.check_call(['git', 'checkout', '-b', branch_name, 'origin/main'], cwd=root_dir)

    # Create auto-generated changes to the new git branch
    subprocess.check_call(['git', 'add', '-u', '.'], cwd=root_dir)
    subprocess.check_call(['git', 'commit', '-m', new_version], cwd=root_dir)
    print('New release created in branch: `%s`' % branch_name)

    # Push new branch to origin
    subprocess.check_call(['git', 'push', 'origin', branch_name], cwd=root_dir)

  return 0


if __name__ == '__main__':
  sys.exit(main())
