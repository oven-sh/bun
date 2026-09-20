# Homebrew is already there: the Tart base image ships it, and
# scripts/darwin-ci installs it on a bare host before anything else.
add_to_path "$BREW_PREFIX/bin"
