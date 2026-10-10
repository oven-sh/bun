import type { Dependency } from "../source.ts";

const LCMS2_COMMIT = "21c582a594fe5279f90c0b93437c398f93bf62b0"; // 2.19.1

export const lcms2: Dependency = {
  name: "lcms2",
  source: () => ({
    kind: "github-archive",
    repo: "mm2/Little-CMS",
    commit: LCMS2_COMMIT,
  }),
  build: () => ({
    kind: "direct",
    sources: [
      "cmscnvrt",
      "cmserr",
      "cmsgamma",
      "cmsgmt",
      "cmsintrp",
      "cmsio0",
      "cmsio1",
      "cmslut",
      "cmsplugin",
      "cmssm",
      "cmsmd5",
      "cmsmtrx",
      "cmspack",
      "cmspcs",
      "cmswtpnt",
      "cmsxform",
      "cmssamp",
      "cmsnamed",
      "cmscam02",
      "cmsvirt",
      "cmstypes",
      "cmscgats",
      "cmsps2",
      "cmsopt",
      "cmshalf",
      "cmsalpha",
    ].map(name => `src/${name}.c`),
    includes: ["include"],
  }),
  provides: () => ({ libs: [], includes: ["include"] }),
};
