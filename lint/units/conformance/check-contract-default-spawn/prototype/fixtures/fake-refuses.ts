// Stand-in for a command whose flag is not enabled.
process.stderr.write("error: --lint is experimental: set BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1\n");
process.exit(1);
