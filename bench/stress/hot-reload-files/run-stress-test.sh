#!/bin/bash

# Clean up modules directory
rm -rf modules

# Generate the module files
echo "Generating 1000 module files..."
bun generate.ts

# Run the stress test
echo "Running stress test for 1000 reloads..."
bun stress-test.ts

# All done - the stress test manages the child process internally