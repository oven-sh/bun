#!/usr/bin/env node

/**
 * This script can be used to generate and add the ASAN CI job configuration
 * to the BuildKite pipeline. It should be integrated with your existing
 * CI configuration setup.
 */

// Example configuration for an ASAN build job
const asanBuildJob = {
  label: ":linux: ASAN Release with Assertions",
  key: "linux-asan-release-assert",
  agents: {
    os: "linux",
    arch: "x64" // You may also want to add ARM64 later
  },
  timeout_in_minutes: 60, // ASAN builds might take longer
  commands: [
    // Configure build with ASAN and assertions enabled
    "cmake -B build -DCMAKE_BUILD_TYPE=Release -DENABLE_ASAN_RELEASE=ON -DENABLE_ASSERTIONS=ON",
    // Build with parallel jobs
    "cmake --build build --parallel",
    // Run a subset of tests (ASAN might make tests run slower)
    "cd build && ctest -L unit -E 'slow|performance' --output-on-failure"
  ],
  // Scale back test distribution due to ASAN overhead
  plugins: [
    {
      "docker#v5.3.0": {
        image: "your-docker-image:tag",
        workdir: "/app",
        volumes: [
          "/cache:/cache"
        ],
        environment: [
          "ASAN_OPTIONS=detect_leaks=0:halt_on_error=0:detect_odr_violation=0",
          "LSAN_OPTIONS=suppressions=lsan.supp:print_suppressions=0"
        ]
      }
    }
  ],
  artifact_paths: [
    "build/bun-asan-release-assert*"
  ]
};

// This job definition can be integrated with your existing BuildKite pipeline setup
console.log(JSON.stringify(asanBuildJob, null, 2));

/**
 * Integration notes:
 * 
 * 1. You should modify the docker image and other settings to match your existing CI setup
 * 2. This job should be integrated into the CI pipeline, e.g., in build.mjs
 * 3. Create suppressions file for false positives in LSAN if needed
 * 4. Consider adding a separate ASAN test suite that's optimized for finding memory issues
 */