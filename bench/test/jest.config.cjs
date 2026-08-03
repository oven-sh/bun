/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/app/tests"],
  transform: { "^.+\\.tsx?$": ["@swc/jest"] },
  setupFilesAfterEnv: ["<rootDir>/app/preload.ts"],
};
