const say = (label: string, act: () => void) => { let seen = "no throw"; try { act(); } catch (e: any) { seen = e.name + ": " + e.message; } console.log(label, seen); };
test("stores", () => {
  say("=", () => { (expect as any) = 1; });
  console.log(typeof expect);
});
