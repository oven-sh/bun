#!/usr/bin/env python3

import json
import sys


def get_latest(tagfile):
    with open(tagfile) as f:
        versions = json.load(f)
        print(versions['aliases']['latest'])
    return 0


def get_hash(tagfile, version):
    with open(tagfile) as f:
        versions = json.load(f)
        print(versions['releases'][version])
    return 0


if __name__ == '__main__':
    if sys.argv[2] == 'latest':
        sys.exit(get_latest(sys.argv[1]))
    if sys.argv[2] == 'hash':
        sys.exit(get_hash(sys.argv[1], sys.argv[3]))
