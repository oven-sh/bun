#!/usr/bin/env python3

import json
import os
import subprocess
import sys

EMSCRIPTEN_RELEASES_GIT = 'https://chromium.googlesource.com/emscripten-releases'
TAGFILE = 'emscripten-releases-tags.json'


def get_latest_hash(tagfile):
    with open(tagfile) as f:
        versions = json.load(f)
        latest = versions['aliases']['latest']
        return versions['releases'][latest]


def get_latest_emscripten(tagfile):
    latest = get_latest_hash(tagfile)
    if not os.path.isdir('emscripten-releases'):
        subprocess.run(['git', 'clone', EMSCRIPTEN_RELEASES_GIT, '--depth',
                        '100'], check=True)
    # This will fail if the 'latest' revision is not within the most recent
    # 100 commits; but that shouldn't happen because this script is intended
    # to be run right after a release is added.
    info = subprocess.run(['emscripten-releases/src/release-info.py',
                           'emscripten-releases', latest],
                          stdout=subprocess.PIPE, check=True, text=True).stdout
    for line in info.split('\n'):
        tokens = line.split()
        if len(tokens) and tokens[0] == 'emscripten':
            return tokens[2]


if __name__ == '__main__':
    emscripten_hash = get_latest_emscripten(TAGFILE)
    print('Emscripten revision ' + emscripten_hash)
    if 'GITHUB_ENV' in os.environ:
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            f.write(f'EMSCRIPTEN_HASH={emscripten_hash}')
        sys.exit(0)
    print('Not a GitHub Action')
    sys.exit(1)
