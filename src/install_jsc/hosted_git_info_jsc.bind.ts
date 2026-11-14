import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::hosted_git_info_jsc" });

export const parseUrl = b.fn({
  args: { url: b.string.utf8 },
  returns: b.string,
  capability: "heap",
  throws: true,
});

export const HostedGitInfo = b.dictionary({
  type: b.string,
  domain: b.string,
  project: b.string,
  user: b.string.nullable,
  committish: b.string.nullable,
  default: { type: b.string, rustName: "default_representation" },
});

export const fromUrl = b.fn({
  args: { url: b.string.utf8 },
  returns: HostedGitInfo.nullable,
  capability: "heap",
  throws: true,
});
