let OSRelease;

const COLORS_2 = 1;
const COLORS_16 = 4;
const COLORS_256 = 8;
const COLORS_16m = 24;

// Some entries were taken from `dircolors`
// (https://linux.die.net/man/1/dircolors). The corresponding terminals might
// support more than 16 colors, but this was not tested for.
//
// Copyright (C) 1996-2016 Free Software Foundation, Inc. Copying and
// distribution of this file, with or without modification, are permitted
// provided the copyright notice and this notice are preserved.
const TERM_ENVS = {
  "eterm": COLORS_16,
  "cons25": COLORS_16,
  "console": COLORS_16,
  "cygwin": COLORS_16,
  "dtterm": COLORS_16,
  "gnome": COLORS_16,
  "hurd": COLORS_16,
  "jfbterm": COLORS_16,
  "konsole": COLORS_16,
  "kterm": COLORS_16,
  "mlterm": COLORS_16,
  "mosh": COLORS_16m,
  "putty": COLORS_16,
  "st": COLORS_16,
  // http://lists.schmorp.de/pipermail/rxvt-unicode/2016q2/002261.html
  "rxvt-unicode-24bit": COLORS_16m,
  // https://bugs.launchpad.net/terminator/+bug/1030562
  "terminator": COLORS_16m,
  "xterm-kitty": COLORS_16m,
};

const CI_ENVS = {
  APPVEYOR: COLORS_256,
  BUILDKITE: COLORS_256,
  CIRCLECI: COLORS_16m,
  DRONE: COLORS_256,
  GITEA_ACTIONS: COLORS_16m,
  GITHUB_ACTIONS: COLORS_16m,
  GITLAB_CI: COLORS_256,
  TRAVIS: COLORS_256,
};

const TERM_ENVS_REG_EXP = [
  /ansi/,
  /color/,
  /linux/,
  /direct/,
  /^con[0-9]*x[0-9]/,
  /^rxvt/,
  /^screen/,
  /^xterm/,
  /^vt100/,
  /^vt220/,
];

let warned = false;
function warnOnDeactivatedColors(env) {
  if (warned) return;
  let name = "";
  if (env.NODE_DISABLE_COLORS !== undefined && env.NODE_DISABLE_COLORS !== "") name = "NODE_DISABLE_COLORS";
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    if (name !== "") {
      name += "' and '";
    }
    name += "NO_COLOR";
  }

  if (name !== "") {
    process.emitWarning(`The '${name}' env is ignored due to the 'FORCE_COLOR' env being set.`, "Warning");
    warned = true;
  }
}

function getColorDepth(env: NodeJS.ProcessEnv) {
  const FORCE_COLOR = env.FORCE_COLOR;
  // Use level 0-3 to support the same levels as `chalk` does. This is done for
  // consistency throughout the ecosystem.
  if (FORCE_COLOR !== undefined) {
    switch (FORCE_COLOR) {
      case "":
      case "1":
      case "true":
        warnOnDeactivatedColors(env);
        return COLORS_16;
      case "2":
        warnOnDeactivatedColors(env);
        return COLORS_256;
      case "3":
        warnOnDeactivatedColors(env);
        return COLORS_16m;
      default:
        return COLORS_2;
    }
  }

  if (
    (env.NODE_DISABLE_COLORS !== undefined && env.NODE_DISABLE_COLORS !== "") ||
    // See https://no-color.org/
    (env.NO_COLOR !== undefined && env.NO_COLOR !== "") ||
    // The "dumb" special terminal, as defined by terminfo, doesn't support
    // ANSI color control codes.
    // See https://invisible-island.net/ncurses/terminfo.ti.html#toc-_Specials
    env.TERM === "dumb"
  ) {
    return COLORS_2;
  }

  if (process.platform === "win32") {
    // Lazy load for startup performance.
    if (OSRelease === undefined) {
      const { release } = require("node:os");
      OSRelease = release().split(".");
    }
    // Windows 10 build 10586 is the first Windows release that supports 256
    // colors. Windows 10 build 14931 is the first release that supports
    // 16m/TrueColor.
    if (+OSRelease[0] >= 10) {
      const build = +OSRelease[2];
      if (build >= 14931) return COLORS_16m;
      if (build >= 10586) return COLORS_256;
    }

    return COLORS_16;
  }

  if (env.TMUX) {
    return COLORS_16m;
  }

  // Azure DevOps
  if ("TF_BUILD" in env && "AGENT_NAME" in env) {
    return COLORS_16;
  }

  if ("CI" in env) {
    for (const name in CI_ENVS) {
      if (name in env) {
        return CI_ENVS[name];
      }
    }
    if (env.CI_NAME === "codeship") {
      return COLORS_256;
    }
    return COLORS_2;
  }

  if ("TEAMCITY_VERSION" in env) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? COLORS_16 : COLORS_2;
  }

  switch (env.TERM_PROGRAM) {
    case "iTerm.app":
      if (!env.TERM_PROGRAM_VERSION || /^[0-2]\./.test(env.TERM_PROGRAM_VERSION)) {
        return COLORS_256;
      }
      return COLORS_16m;
    case "HyperTerm":
    case "ghostty":
    case "WezTerm":
    case "MacTerm":
      return COLORS_16m;
    case "Apple_Terminal":
      return COLORS_256;
  }

  const COLORTERM = env.COLORTERM;

  if (COLORTERM === "truecolor" || COLORTERM === "24bit") {
    return COLORS_16m;
  }

  const TERM = env.TERM;

  if (TERM) {
    if (/truecolor/.test(TERM)) {
      return COLORS_16m;
    }

    if (TERM.startsWith("xterm-256")) {
      return COLORS_256;
    }

    const termEnv = TERM.toLowerCase();

    if (TERM_ENVS[termEnv]) {
      return TERM_ENVS[termEnv];
    }
    if (TERM_ENVS_REG_EXP.some(term => term.test(termEnv))) {
      return COLORS_16;
    }
  }

  // Move 16 color COLORTERM below 16m and 256
  if (env.COLORTERM) {
    return COLORS_16;
  }
  return COLORS_2;
}

export default { getColorDepth };
