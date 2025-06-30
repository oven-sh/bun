#!/usr/bin/env python3
# This script will update emsdk/bazel/revisions.bzl to the latest version of
# emscripten. It reads emsdk/emscripten-releases-tags.json to get the latest
# version number. Then, it downloads the prebuilts for that version and computes
# the sha256sum for the archive. It then puts all this information into the
# emsdk/bazel/revisions.bzl file.

import hashlib
import json
import os
import re
import requests
import sys

STORAGE_URL = 'https://storage.googleapis.com/webassembly/emscripten-releases-builds'

EMSDK_ROOT = os.path.dirname(os.path.dirname(__file__))
RELEASES_TAGS_FILE = EMSDK_ROOT + '/emscripten-releases-tags.json'
BAZEL_REVISIONS_FILE = EMSDK_ROOT + '/bazel/revisions.bzl'
BAZEL_MODULE_FILE = EMSDK_ROOT + '/bazel/MODULE.bazel'


def get_latest_info():
    with open(RELEASES_TAGS_FILE) as f:
        info = json.load(f)
    latest = info['aliases']['latest']
    return latest, info['releases'][latest]


def get_sha(platform, archive_fmt, latest_hash, arch_suffix=''):
    r = requests.get(f'{STORAGE_URL}/{platform}/{latest_hash}/wasm-binaries{arch_suffix}.{archive_fmt}')
    r.raise_for_status()
    print(f'Fetching {r.url}')
    h = hashlib.new('sha256')
    for chunk in r.iter_content(chunk_size=1024):
        h.update(chunk)
    return h.hexdigest()


def revisions_item(version, latest_hash):
    return f'''\
    "{version}": struct(
        hash = "{latest_hash}",
        sha_linux = "{get_sha('linux', 'tar.xz', latest_hash)}",
        sha_linux_arm64 = "{get_sha('linux', 'tar.xz', latest_hash, '-arm64')}",
        sha_mac = "{get_sha('mac', 'tar.xz', latest_hash)}",
        sha_mac_arm64 = "{get_sha('mac', 'tar.xz', latest_hash, '-arm64')}",
        sha_win = "{get_sha('win', 'zip', latest_hash)}",
    ),
'''


def insert_revision(item):
    with open(BAZEL_REVISIONS_FILE, 'r') as f:
        lines = f.readlines()

    lines.insert(lines.index('EMSCRIPTEN_TAGS = {\n') + 1, item)

    with open(BAZEL_REVISIONS_FILE, 'w') as f:
        f.write(''.join(lines))


def update_module_version(version):
    with open(BAZEL_MODULE_FILE, 'r') as f:
        content = f.read()

    pattern = r'(module\(\s*name = "emsdk",\s*version = )"\d+.\d+.\d+",\n\)'
    # Verify that the pattern exists in the input since re.sub will
    # will succeed either way.
    assert re.search(pattern, content)
    content = re.sub(pattern, fr'\1"{version}",\n)', content)

    with open(BAZEL_MODULE_FILE, 'w') as f:
        f.write(content)


def main(argv):
    version, latest_hash = get_latest_info()
    update_module_version(version)
    item = revisions_item(version, latest_hash)
    print('inserting item:')
    print(item)
    insert_revision(item)


if __name__ == '__main__':
    sys.exit(main(sys.argv))
