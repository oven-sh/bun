"""Unpackages a bazel emscripten archive for use in a bazel BUILD rule.

This script will take a tar archive containing the output of the emscripten
toolchain. This file contains any output files produced by a wasm_cc_binary or a
cc_binary built with --config=wasm. The files are extracted into the given
output paths.

The contents of the archive are expected to match the given outputs extnames.

This script and its accompanying Bazel rule should allow you to extract a
WebAssembly binary into a larger web application.
"""

import argparse
import os
import tarfile


def ensure(f):
  if not os.path.exists(f):
    with open(f, 'w'):
      pass


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--archive', help='The archive to extract from.')
  parser.add_argument('--outputs', help='Comma separated list of files that should be extracted from the archive. Only the extname has to match a file in the archive.')
  parser.add_argument('--allow_empty_outputs', help='If an output listed in --outputs does not exist, create it anyways.', action='store_true')
  args = parser.parse_args()

  args.archive = os.path.normpath(args.archive)
  args.outputs = args.outputs.split(",")

  tar = tarfile.open(args.archive)

  for member in tar.getmembers():
    extname = '.' + member.name.split('.', 1)[1]
    for idx, output in enumerate(args.outputs):
      if output.endswith(extname):
        member_file = tar.extractfile(member)
        with open(output, "wb") as output_file:
          output_file.write(member_file.read())
        args.outputs.pop(idx)
        break

  for output in args.outputs:
    extname = '.' + output.split('.', 1)[1]
    if args.allow_empty_outputs:
      ensure(output)
    else:
      print("[ERROR] Archive does not contain file with extname: %s" % extname)


if __name__ == '__main__':
  main()
