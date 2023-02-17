export type Package = {
  readonly name: string;
  readonly repository: string;
  readonly cwd?: string;
  readonly tests?: {
    readonly style: "jest" | "ava" | "tape" | "custom";
    readonly include: string[];
    readonly exclude?: string[];
    readonly disabled?: boolean;
  };
};

export const packages: Package[] = [
  {
    name: "lodash",
    repository: github("lodash/lodash"),
    tests: {
      style: "jest",
      include: ["test/*.js"],
      exclude: [
        "debounce.test.js", // hangs runner
        "size.test.js", // require('vm').runInNewContext()
        "merge.test.js", // failing
      ],
    },
  },
  {
    name: "chalk",
    repository: github("chalk/chalk"),
    tests: {
      style: "ava",
      include: ["test/*.js"],
    },
  },
  {
    name: "request",
    repository: github("request/request"),
    tests: {
      style: "tape",
      include: ["tests/*.js"],
    },
  },
  {
    name: "commander",
    repository: github("tj/commander.js"),
    tests: {
      style: "jest",
      include: ["tests/*.js"],
    },
  },
  {
    name: "express",
    repository: github("expressjs/express"),
    tests: {
      style: "jest",
      include: ["test/**/*.js"],
      exclude: [
        "test/res.sendStatus.js", // https://github.com/oven-sh/bun/issues/887
        "test/Route.js", // https://github.com/oven-sh/bun/issues/2030
      ],
      // Most tests fail due to lack of "http2"
      disabled: true,
    },
  },
];

function github(repository: string): string {
  return `git@github.com:${repository}.git`;
}
