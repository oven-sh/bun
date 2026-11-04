// Entry points: ./modules/a.ts ./modules/b.ts
for (const name of ["./modules/a.ts", "./modules/b.ts"]) {
  const found = await import(name);
  console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
}
