#Adds bun commands to tab completion and visual command validation (only top-level commands for now)
#Built-in completion should handle everything else

#Source in config file to use

module completions {
  # Start a bun Dev server
  export extern "bun dev" []

  # Bundle dependencies of input files into a .bun
  export extern "bun bun" []

  # Start a new project from a template (bun c)
  export extern "bun create" []

  # Run JavaScript with bun, a package.json script, or a bin
  export extern "bun run" []

  # Install dependencies for a package.json (bun i)
  export extern "bun install" []

  # Add a dependency to package.json (bun a)
  export extern "bun add" []

  # Remove a dependency from package.json (bun rm)
  export extern "bun remove" []

  # Get the latest version of bun
  export extern "bun upgrade" []

  # Install shell completions for tab-completion
  export extern "bun completions" []

  # Open bun's Discord server
  export extern "bun discord" []

  # Print this help menu
  export extern "Print bun help menu" []
}

use completions *