// A check module for sweep.ts --check: it reports nothing. H is the directory of sweep.ts.
const home = process.env.H;
if (home === undefined) throw new Error("set H to the directory of sweep.ts");
const { emptyCheck } = await import(`${home}/runner`);

export default emptyCheck;
