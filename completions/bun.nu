module completions {

  # Package.json script names
  def "nu-complete bun scripts" [] {
      if ("package.json" | path exists) {
          open package.json | get scripts? | default {} | columns
      } else {
          []
      }
  }

  # Installed packages for remove command
  def "nu-complete bun packages" [] {
      if ("package.json" | path exists) {
          let deps = (open package.json | get dependencies? | default {} | columns)
          let devDeps = (open package.json | get devDependencies? | default {} | columns)
          $deps | append $devDeps | uniq
      } else {
          []
      }
  }

  # Bun templates
  def "nu-complete bun templates" [] {
      [
          "blank" "discord-interactions" "elysia" "elysia-eden" "figma" "hono"
          "kingworld" "next" "next-app" "node-server" "node-express" "react"
          "react-app" "storybook" "vite"
      ]
  }

  # Bun commands
  def "nu-complete bun commands" [] {
      [
          { value: "run", description: "Execute a file or package.json script" }
          { value: "test", description: "Run unit tests" }
          { value: "x", description: "Execute a package binary (bunx)" }
          { value: "repl", description: "Start a REPL session" }
          { value: "exec", description: "Run a shell script" }
          { value: "install", description: "Install dependencies" }
          { value: "add", description: "Add a dependency" }
          { value: "remove", description: "Remove a dependency" }
          { value: "update", description: "Update dependencies" }
          { value: "outdated", description: "Show outdated dependencies" }
          { value: "link", description: "Link a local package" }
          { value: "unlink", description: "Unlink a local package" }
          { value: "publish", description: "Publish to npm registry" }
          { value: "patch", description: "Prepare package for patching" }
          { value: "pm", description: "Package management utilities" }
          { value: "build", description: "Bundle files" }
          { value: "init", description: "Start new Bun project" }
          { value: "create", description: "Create from template" }
          { value: "upgrade", description: "Upgrade Bun" }
      ]
  }

  # Build targets
  def "nu-complete bun build target" [] {
      [ "browser" "bun" "node" ]
  }

  # Build formats
  def "nu-complete bun build format" [] {
      [ "esm" "cjs" "iife" ]
  }

  # Install behavior
  def "nu-complete bun install behavior" [] {
      [ "auto" "fallback" "force" ]
  }

  # Shell options
  def "nu-complete bun shell" [] {
      [ "bun" "system" ]
  }

  # PM subcommands
  def "nu-complete bun pm commands" [] {
      [
          { value: "bin", description: "Print bin directory" }
          { value: "ls", description: "List installed packages" }
          { value: "hash", description: "Print hash of lockfile" }
          { value: "hash-print", description: "Print hash details" }
          { value: "hash-string", description: "Print string to hash" }
          { value: "cache", description: "Manage cache" }
          { value: "trust", description: "Trust a package" }
          { value: "untrust", description: "Untrust a package" }
          { value: "untrusted", description: "Print current untrusted dependencies with scripts" }
          { value: "default-trusted", description: "Manage default trusted" }
          { value: "pack", description: "Create a tarball of the current workspace" }
          { value: "migrate", description: "Migrate another package manager's lockfile" }
          { value: "whoami", description: "Print the current npm username" }
      ]
  }

  # Bun - A fast JavaScript runtime, package manager, bundler, and test runner
  export extern bun [
    command?: string@"nu-complete bun commands"
    ...args: string
    --watch                       # Auto restart on file change
    --hot                         # Enable auto reload
    --no-clear-screen            # Disable clearing terminal screen on reload
    --smol                        # Use less memory, but run garbage collection more often
    --preload(-r): string         # Import module before others are loaded
    --require: string             # Alias of --preload, for Node.js compatibility
    --inspect: string             # Activate Bun's debugger
    --inspect-wait: string        # Activate Bun's debugger, wait for connection
    --inspect-brk: string         # Activate Bun's debugger with breakpoint
    --if-present                  # Exit without error if entrypoint doesn't exist
    --no-install                  # Disable auto install in the Bun runtime
    --install: string@"nu-complete bun install behavior" # Configure auto-install behavior
    -i                            # Auto-install dependencies (equivalent to --install=fallback)
    --eval(-e): string           # Evaluate argument as script
    --print(-p): string          # Evaluate argument as script and print result
    --port: int                   # Set default port for Bun.serve
    --prefer-offline              # Skip staleness checks for packages
    --prefer-latest               # Use latest matching versions of packages
    --conditions: string         # Pass custom conditions to resolve
    --fetch-preconnect: string   # Preconnect to URL while code is loading
    --max-http-header-size: int  # Set max size of HTTP headers in bytes (default: 16KiB)
    --dns-result-order: string   # Set DNS lookup result order (verbatim/ipv4first/ipv6first)
    --expose-gc                  # Expose gc() on global object
    --no-deprecation            # Suppress all deprecation warnings
    --throw-deprecation         # Throw errors on deprecation warnings
    --title: string             # Set process title
    --zero-fill-buffers         # Force Buffer.allocUnsafe(size) to be zero-filled
    --redis-preconnect          # Preconnect to $REDIS_URL at startup
    --silent                    # Don't print script command
    --elide-lines: int          # Lines of script output shown with --filter (default: 10)
    --version(-v)               # Print version and exit
    --revision                  # Print version with revision and exit
    --filter(-F): string         # Run script in matching workspace packages
    --bun(-b)                   # Force Bun's runtime instead of Node.js
    --shell: string@"nu-complete bun shell" # Control shell used for package.json scripts
    --env-file: path            # Load environment variables from file
    --cwd: path                 # Absolute path to resolve files from
    --config(-c): path          # Specify path to Bun config file (default: bunfig.toml)
    --help(-h)                  # Display this menu and exit
  ]

  # Execute a file or package.json script
  export extern "bun run" [
    script?: string@"nu-complete bun scripts"
    ...args: string
    --watch                       # Auto restart on file change
    --hot                         # Enable auto reload
    --smol                        # Use less memory
    --if-present                  # Exit without error if script missing
    --silent                      # Don't print script command
    --filter(-F): string         # Run in matching workspace packages
    --bun(-b)                    # Force Bun runtime
    --shell: string@"nu-complete bun shell" # Shell for scripts
  ]

  # Run unit tests with Bun
  export extern "bun test" [
    ...files: path               # Test files to run
    --bail: int                  # Exit the test suite after N failures (default: 0)
    --coverage                   # Generate code coverage report
    --coverage-reporter: string  # Coverage reporter format (text/lcov)
    --coverage-dir: path        # Directory for coverage files (default: coverage)
    --only                       # Only run tests marked with .only
    --skip                       # Skip tests marked with .skip
    --todo                       # Include tests marked with .todo
    --timeout: int              # Test timeout in milliseconds (default: 5000)
    --update-snapshots          # Update snapshots
    --watch                     # Re-run tests on file changes
    --rerun-each: int           # Run each test N times
    --test-name-pattern(-t): string # Run only tests matching regex pattern
    --reporter: string          # Test reporter format (currently supports junit)
    --reporter-outfile: path    # Output file for test reporter
  ]

  # Install dependencies for a package.json
  export extern "bun install" [
    ...packages: string          # Packages to install
    --yarn(-y)                   # Write yarn.lock file (yarn v1)
    --production(-p)             # Don't install devDependencies
    --no-save                    # Don't update package.json or save lockfile
    --save                       # Save to package.json (true by default)
    --dry-run                    # Don't install anything
    --frozen-lockfile            # Disallow changes to lockfile
    --force(-f)                  # Always request latest versions & reinstall all
    --cache-dir: path           # Store & load cached data from specific directory
    --no-cache                   # Ignore manifest cache entirely
    --silent                     # Don't log anything
    --verbose                    # Excessively verbose logging
    --global(-g)                 # Install globally
    --dev(-d)                    # Save to devDependencies
    --optional                   # Save to optionalDependencies
    --peer                       # Save to peerDependencies
    --exact(-E)                  # Save exact version
    --ca: string                # Provide a Certificate Authority signing certificate
    --cafile: path              # Path to Certificate Authority certificate file
    --no-progress               # Disable the progress bar
    --no-summary                # Don't print a summary
    --no-verify                 # Skip verifying integrity of newly downloaded packages
    --ignore-scripts            # Skip lifecycle scripts in package.json
    --trust: string             # Add to trustedDependencies in package.json
  ]

  # Add a dependency to package.json
  export extern "bun add" [
    ...packages: string          # Packages to add
    --dev(-d)                    # Add to devDependencies
    --optional                   # Add to optionalDependencies
    --peer                       # Add to peerDependencies
    --exact(-E)                  # Save exact version
    --global(-g)                 # Install globally
    --yarn(-y)                   # Write yarn.lock file
    --production(-p)             # Skip devDependencies
    --dry-run                    # Don't install
    --frozen-lockfile            # Disallow lockfile changes
    --force(-f)                  # Force reinstall
    --no-save                    # Don't update package.json
    --ca: string                # Provide a Certificate Authority signing certificate
    --cafile: path              # Path to Certificate Authority certificate file
    --no-progress               # Disable the progress bar
    --no-summary                # Don't print a summary
    --no-verify                 # Skip verifying integrity
    --ignore-scripts            # Skip lifecycle scripts
    --trust: string             # Add to trustedDependencies
  ]

  # Remove a dependency from package.json
  export extern "bun remove" [
    ...packages: string@"nu-complete bun packages" # Packages to remove
    --yarn(-y)                   # Write yarn.lock file
    --production(-p)             # Skip devDependencies
    --dry-run                    # Don't remove
    --frozen-lockfile            # Disallow lockfile changes
    --global(-g)                 # Remove globally
  ]

  # Update outdated dependencies
  export extern "bun update" [
    ...packages: string@"nu-complete bun packages" # Packages to update
    --latest                     # Update to latest versions ignoring semver
    --yarn(-y)                   # Write yarn.lock file
    --production(-p)             # Skip devDependencies
    --dry-run                    # Don't update
    --frozen-lockfile            # Disallow lockfile changes
    --force(-f)                  # Force update
  ]

  # Execute a package binary (CLI), installing if needed
  export extern "bun x" [
    package: string              # Package to execute
    ...args: string             # Arguments to pass to the package
    --bun(-b)                   # Force Bun runtime
  ]

  # Create a new project from a template
  export extern "bun create" [
    template?: string@"nu-complete bun templates" # Template to use
    destination?: path           # Where to create project
    --no-git                    # Skip git init
    --no-install                # Skip dependency install
    --open                      # Open in browser after creation
  ]

  # Start an empty Bun project from a built-in template
  export extern "bun init" [
    --yes(-y)                   # Accept all defaults
  ]

  # Bundle TypeScript & JavaScript into a single file
  export extern "bun build" [
    ...entrypoints: path        # Files to bundle
    --outdir: path              # Output directory
    --outfile: path             # Output file
    --target: string@"nu-complete bun build target" # Build target
    --format: string@"nu-complete bun build format" # Output format
    --watch                     # Watch for changes
    --splitting                 # Enable code splitting
    --sourcemap: string         # Generate sourcemaps (none|inline|external|linked)
    --minify                    # Minify output
    --minify-whitespace         # Minify whitespace only
    --minify-identifiers        # Minify identifiers only
    --minify-syntax             # Minify syntax only
    --external: string          # Mark module as external (can be repeated)
    --public-path: string       # Public URL path
    --define: string            # Define global constants (K:V)
    --loader: string            # Set loader for file type (.ext:loader)
    --serve                     # Start dev server after building
    --compile                   # Create standalone executable
    --production                # Set NODE_ENV=production and enable minification
    --no-bundle                # Transpile only, do not bundle
    --packages: string          # Bundle external packages (bundle/external)
    --root: path               # Root directory for multiple entry points
    --entry-naming: string     # Entry point file name pattern
    --chunk-naming: string     # Chunk file name pattern
    --asset-naming: string     # Asset file name pattern
    --banner: string           # Add banner to bundled output
    --footer: string           # Add footer to bundled output
  ]

  # Upgrade to latest version of Bun
  export extern "bun upgrade" [
    --stable                    # Upgrade to latest stable release
    --canary                    # Upgrade to canary build
    --force(-f)                 # Force reinstall even if up to date
  ]

  # Additional package management utilities
  export extern "bun pm" [
    subcommand: string@"nu-complete bun pm commands"
    ...args: string
  ]

  # Display latest versions of outdated dependencies
  export extern "bun outdated" []

  # Register or link a local npm package
  export extern "bun link" [
    package?: string            # Package name to link
  ]

  # Unregister a local npm package
  export extern "bun unlink" [
    package?: string            # Package name to unlink
  ]

  # Publish a package to the npm registry
  export extern "bun publish" [
    --tag: string              # Publish with custom tag
    --access: string           # Set access level (public/restricted)
    --dry-run                  # Perform all steps except upload
  ]

  # Prepare a package for patching
  export extern "bun patch" [
    package: string            # Package to patch
  ]

  # Start a REPL session with Bun
  export extern "bun repl" []

  # Run a shell script directly with Bun
  export extern "bun exec" [
    ...args: string           # Script and arguments
  ]
}

export use completions *
