/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  transform: { "^.+\\.tsx?$": ["@swc/jest"] },
  setupFilesAfterEnv: ["<rootDir>/preload.ts"],
};
