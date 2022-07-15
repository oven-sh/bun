#Adds bun commands to tab completion and visual command validation (very much in beta)
#Source in config file to use

module completions {

	def "frameworks" [] {
		["blank", "discord-interactions", "hono", "next", "react"]
	}

	def "runtime" [] {
		["automatic", "classic"]
	}

	def "backend" [] {
		["clonefile", "copyfile", "hardlink", "clonefile_each_dir"]
	}

	# Run a script or package bin
	export extern "bun run" [
		script: string
		--silent								# Run a script or package bin
	]

	# Create a new project
	export extern "bun create" [
		framework: string@"frameworks"
		name?: string
	]

	# Next.js app
	export extern "bun create next" [
		name?: string
	]

	# React app
	export extern "bun create react" [
		name?: string
	]

	# Generate a bundle
	export extern "bun bun" [
		name?: string
		--use: string							# Use a framework, e.g. "next"
	]

	# Upgrade to the latest version of bun
	export extern "bun upgrade" []

	# Start a dev server
	export extern "bun dev" [
		--bunfile: string						# Use a specific .bun file (default: node_modules.bun)
		--origin(-u): string					# Rewrite import paths to start from a different url. Default: http://localhost:3000
		--server-bunfile: string				# Use a specific .bun file for SSR in bun dev (default: node_modules.server.bun)
		--extension-order: string				# defaults to: .tsx,.ts,.jsx,.js,.json
		--jsx-runtime: string@"runtime"			# JSX runtime to use. Defaults to "automatic"
		--main-fields: string					# Main fields to lookup in package.json. Defaults to --platform dependent
		--disable-react-fast-refresh			# Disable React Fast Refresh
		--disable-hmr							# Disable Hot Module Reloading
		--jsx-factory: string					# Changes the function called when compiling JSX elements using the classic JSX runtime
		--jsx-fragment: string					# Changes the function called when compiling JSX fragments
		--jsx-import-source: string				# Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"
		--port: int								# Port number
	]

	# Install packages from package.json
	export extern "bun install" [
		--registry: string						# Change default registry (default: $BUN_CONFIG_REGISTRY || $npm_config_registry)
		--token: string							# Authentication token used for npm registry requests (default: $npm_config_token)
		--yarn(-y)								# Write a yarn.lock file (yarn v1)
		--production(-p)						# Don't install devDependencies
		--no-save								# Don't save action
		--dry-run								# Don't install anything
		--force									# Always request the latest versions from the registry & reinstall all dependenices
		--lockfile:string						# Store & load a lockfile at a specific filepath
		--cache-dir:string						# Store & load cached data from a specific directory path
		--no-cache								# Ignore manifest cache entirely
		--silent								# Don't output anything
		--verbose								# Excessively verbose logging
		--cwd									# Set a specific cwd
		--backend: string@"backend"				# Platform-specific optimizations for installing dependencies
		--link-native-bins						# Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo
	]

	# Add a dependency to package.json
	export extern "bun add" [
		package: string
		--registry: string						# Change default registry (default: $BUN_CONFIG_REGISTRY || $npm_config_registry)
		--token: string							# Authentication token used for npm registry requests (default: $npm_config_token)
		--yarn(-y)								# Write a yarn.lock file (yarn v1)
		--production(-p)						# Don't install devDependencies
		--optional								# Add dependency to optionalDependencies
		--development(-d)						# Add dependency to devDependencies
		--no-save								# Don't save action
		--dry-run								# Don't install anything
		--force									# Always request the latest versions from the registry & reinstall all dependenices
		--lockfile:string						# Store & load a lockfile at a specific filepath
		--cache-dir:string						# Store & load cached data from a specific directory path
		--no-cache								# Ignore manifest cache entirely
		--silent								# Don't output anything
		--verbose								# Excessively verbose logging
		--cwd									# Set a specific cwd
		--backend: string@"backend"				# Platform-specific optimizations for installing dependencies
		--link-native-bins						# Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo
	]

	# Remove a dependency from package.json
	export extern "bun remove" [
		package: string
		--registry: string						# Change default registry (default: $BUN_CONFIG_REGISTRY || $npm_config_registry)
		--token: string							# Authentication token used for npm registry requests (default: $npm_config_token)
		--yarn(-y)								# Write a yarn.lock file (yarn v1)
		--production(-p)						# Don't install devDependencies
		--no-save								# Don't save action
		--dry-run								# Don't install anything
		--force									# Always request the latest versions from the registry & reinstall all dependenices
		--lockfile:string						# Store & load a lockfile at a specific filepath
		--cache-dir:string						# Store & load cached data from a specific directory path
		--no-cache								# Ignore manifest cache entirely
		--silent								# Don't output anything
		--verbose								# Excessively verbose logging
		--cwd									# Set a specific cwd
		--backend: string@"backend"				# Platform-specific optimizations for installing dependencies
		--link-native-bins						# Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo
	]

	# Print help information
	export extern "bun help" []

	# Install shell completions for tab-completion
	export extern "bun completions" []

	# Open bun's Discord server
	export extern "bun discord" []
}

use completions *
