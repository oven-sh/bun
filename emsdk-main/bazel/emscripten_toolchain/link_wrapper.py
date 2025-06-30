#!/usr/bin/env python
"""wrapper around emcc link step.

This wrapper currently serves the following purposes.

1. When building with --config=wasm the final output is multiple files, usually
   at least one .js and one .wasm file. Since the cc_binary link step only
   allows a single output, we must tar up the outputs into a single file.

2. Add quotes around arguments that need them in the response file to work
   around a bazel quirk.

3. Ensure the external_debug_info section of the wasm points at the correct
   bazel path.
"""

from __future__ import print_function

import argparse
import os
import subprocess
import sys

# Only argument should be @path/to/parameter/file
assert sys.argv[1][0] == '@', sys.argv
param_filename = sys.argv[1][1:]
param_file_args = [line.strip() for line in open(param_filename, 'r').readlines()]

# Re-write response file if needed.
if any(' ' in a for a in param_file_args):
  new_param_filename = param_filename + '.modified'
  with open(new_param_filename, 'w') as f:
    for param in param_file_args:
      if ' ' in param:
        f.write('"%s"' % param)
      else:
        f.write(param)
      f.write('\n')
  sys.argv[1] = '@' + new_param_filename

emcc_py = os.path.join(os.environ['EMSCRIPTEN'], 'emcc.py')
rtn = subprocess.call([sys.executable, emcc_py] + sys.argv[1:])
if rtn != 0:
  sys.exit(1)

# Parse the arguments that we gave to the linker to determine what the output
# file is named and what the output format is.
parser = argparse.ArgumentParser(add_help=False)
parser.add_argument('-o')
parser.add_argument('--oformat')
options = parser.parse_known_args(param_file_args)[0]
output_file = options.o
oformat = options.oformat
outdir = os.path.normpath(os.path.dirname(output_file))
base_name = os.path.basename(output_file)

# The output file name is the name of the build rule that was built.
# Add an appropriate file extension based on --oformat.
if oformat is not None:
  base_name_split = os.path.splitext(base_name)

  # If the output name has no extension, give it the appropriate extension.
  if not base_name_split[1]:
    os.replace(output_file, output_file + '.' + oformat)

  # If the output name does have an extension and it matches the output format,
  # change the base_name so it doesn't have an extension.
  elif base_name_split[1] == '.' + oformat:
    base_name = base_name_split[0]

  # If the output name does have an extension and it does not match the output
  # format, change the base_name so it doesn't have an extension and rename
  # the output_file so it has the proper extension.
  # Note that if you do something like name your build rule "foo.js" and pass
  # "--oformat=html", emscripten will write to the same file for both the js and
  # html output, overwriting the js output entirely with the html.
  # Please don't do that.
  else:
    base_name = base_name_split[0]
    os.replace(output_file, os.path.join(outdir, base_name + '.' + oformat))

files = []
extensions = [
    '.js',
    '.wasm',
    '.wasm.map',
    '.js.mem',
    '.fetch.js',
    '.worker.js',
    '.data',
    '.js.symbols',
    '.wasm.debug.wasm',
    '.html',
    '.aw.js'
]

for ext in extensions:
  filename = base_name + ext
  if os.path.exists(os.path.join(outdir, filename)):
    files.append(filename)

wasm_base = os.path.join(outdir, base_name + '.wasm')
if os.path.exists(wasm_base + '.debug.wasm') and os.path.exists(wasm_base):
  # If we have a .wasm.debug.wasm file and a .wasm file, we need to rewrite the
  # section in the .wasm file that refers to it. The path that's in there
  # is the blaze output path; we want it to be just the filename.

  llvm_objcopy = os.path.join(
      os.environ['EM_BIN_PATH'], 'bin/llvm-objcopy')
  # First, check to make sure the .wasm file has the header that needs to be
  # rewritten.
  rtn = subprocess.call([
      llvm_objcopy,
      '--dump-section=external_debug_info=/dev/null',
      wasm_base], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
  if rtn == 0:
    # If llvm-objcopy did not return an error, the external_debug_info section
    # must exist, so we're good to continue.

    # Next we need to convert length of the filename to LEB128.
    # Start by converting the length of the filename to a bit string.
    bit_string = '{0:b}'.format(len(base_name + '.wasm.debug.wasm'))

    # Pad the bit string with 0s so that its length is a multiple of 7.
    while len(bit_string) % 7 != 0:
      bit_string = '0' + bit_string

    # Break up our bit string into chunks of 7.
    # We do this backwards because the final format is little-endian.
    final_bytes = bytearray()
    for i in reversed(range(0, len(bit_string), 7)):
      binary_part = bit_string[i:i + 7]
      if i != 0:
        # Every chunk except the last one needs to be prepended with '1'.
        # The length of each chunk is 7, so that one has an implicit '0'.
        binary_part = '1' + binary_part
      final_bytes.append(int(binary_part, 2))
    # Finally, add the actual filename.
    final_bytes.extend((base_name + '.wasm.debug.wasm').encode())

    # Write our length + filename bytes to a temp file.
    with open(base_name + '_debugsection.tmp', 'wb+') as f:
      f.write(final_bytes)
      f.close()

    # First delete the old section.
    subprocess.check_call([
        llvm_objcopy,
        wasm_base,
        '--remove-section=external_debug_info'])
    # Rewrite section with the new size and filename from the temp file.
    subprocess.check_call([
        llvm_objcopy,
        wasm_base,
        '--add-section=external_debug_info=' + base_name + '_debugsection.tmp'])

# Make sure we have at least one output file.
if not len(files):
  print('emcc.py did not appear to output any known files!')
  sys.exit(1)

# cc_binary must output exactly one file; put all the output files in a tarball.
cmd = ['tar', 'cf', base_name + '.tar'] + files
subprocess.check_call(cmd, cwd=outdir)
os.replace(os.path.join(outdir, base_name + '.tar'), output_file)

sys.exit(0)
