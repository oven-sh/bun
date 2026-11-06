// Alone: it asks which file the executable was started as
function main(): void {
  console.log("main runs", import.meta.main);
}
if (require.main === module) main();
