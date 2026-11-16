import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::cli::pack_command::bindings" });

export const TarballEntryKind = b.enumeration([
  "block_device",
  "character_device",
  "directory",
  "named_pipe",
  "sym_link",
  "file",
  "unix_domain_socket",
  "whiteout",
  "door",
  "event_port",
  "unknown",
]);

export const TarballEntry = b.dictionary({
  pathname: b.string,
  kind: TarballEntryKind,
  perm: b.f64,
  contents: b.string.optional,
});

export const Tarball = b.dictionary({
  entries: b.array(TarballEntry),
  size: b.usize,
  shasum: b.string,
  integrity: b.string.utf8,
});

export const readTarball = b.fn({
  args: { tarballPath: b.string.utf8 },
  returns: Tarball,
  capability: "heap",
  throws: true,
});
