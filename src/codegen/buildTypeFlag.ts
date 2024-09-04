const buildTypeFlag = process.argv.find(argv => {
  if (argv.startsWith("--build-type=")) {
    return argv;
  }
});

const enum BuildType {
  debug,
  release,
}
if (buildTypeFlag) {
  process.argv.splice(process.argv.indexOf(buildTypeFlag), 1);
}
let buildType = buildTypeFlag ? BuildType[buildTypeFlag.split("=")[1].toLowerCase()] : BuildType.release;

export { BuildType, buildType };
