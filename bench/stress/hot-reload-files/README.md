# Hot Reload Files Stress Test

This is a stress test for Bun's hot reloading functionality, designed to test performance with a high number of interdependent files.

## What It Does

- Generates 1000 interconnected TypeScript modules
- Each module imports 2 other modules
- Uses IPC (Inter-Process Communication) to detect reloads
- Performs 1,000 hot reloads and tracks memory usage
- Reports statistics about hot reload performance

## Usage

```bash
./run-stress-test.sh
```

This will:

1. Generate 1000 interconnected modules
2. Run the stress test that performs 10,000 hot reloads
3. Report complete performance statistics

## How The Test Works

The test utilizes Node.js's child_process fork API for communication:

1. The main process (stress-test.ts) creates a child process running Bun with hot reloading
2. The modules communicate with the parent process via IPC when they're reloaded
3. After detecting a successful reload, the parent modifies another file
4. This continues for 1,000 iterations
5. Memory usage is tracked throughout the process

## Architecture

- **generate.ts**: Creates 1000 interconnected modules with IPC signaling
- **stress-test.ts**: Controls the test, forks Bun, and tracks metrics
- **run-stress-test.sh**: Script to run the entire test from scratch

## Performance Metrics

The test reports:

- Total number of hot reloads completed
- Time taken to complete all reloads
- Average time per reload
- Initial and final RSS memory usage
