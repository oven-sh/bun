(import
  (
    let
      flake-compat = (builtins.fromJSON (builtins.readFile ./flake.lock)).nodes.flake-compat;
    in
      fetchTarball {
        url = "https://github.com/edolstra/flake-compat/archive/${flake-compat.locked.rev}.tar.gz";
        sha256 = flake-compat.locked.narHash;
      }
  )
  {src = ./.;})
.shellNix
