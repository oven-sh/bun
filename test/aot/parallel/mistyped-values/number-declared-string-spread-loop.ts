// A number declared a string is spread behind a loop in a validating build.
// Flags: --aot-validate
function note(label: string, value: unknown): void {
  console.log(label, JSON.stringify(value));
}

function both<A, B>(first: A[], second: B[]): (A | B)[] {
  return first;
}

function spreadsBehindALoop() {
  let tally = 0;
  try {
    const narrow: string[] = ["sample"];
    both<string, number | string>(narrow, [])[0] = 2.5;
    const arrived: string = narrow[0];
    for (let i = 0; i < 3; i++) tally += i;
    note("behind a loop", [...arrived]);
  } catch (error) {
    console.log("behind a loop", tally, String(error));
  }
}
for (let turn = 0; turn < 2; turn++) spreadsBehindALoop();

function spreadsWhatIsStored(stored: number | string) {
  let tally = 0;
  try {
    const narrow: string[] = ["sample"];
    both<string, number | string>(narrow, [])[0] = stored;
    const arrived: string = narrow[0];
    for (let i = 0; i < 3; i++) tally += i;
    note("stored", [...arrived]);
  } catch (error) {
    console.log("stored", tally, String(error));
  }
}
for (const stored of ["ab", 2.5, "a\u{1F600}b", 7, ""]) spreadsWhatIsStored(stored);

function spreadsInTheLoop(stored: number | string) {
  const lists: string[][] = [];
  try {
    const narrow: string[] = ["sample"];
    both<string, number | string>(narrow, [])[0] = stored;
    const arrived: string = narrow[0];
    for (let i = 0; i < 3; i++) lists.push([...arrived, String(i)]);
  } catch (error) {
    console.log("in the loop", lists.length, String(error));
  }
  note("in the loop", lists);
}
for (const stored of ["xy", 0.5, "z"]) spreadsInTheLoop(stored);

function spreadsIntoACall(stored: number | string) {
  let tally = 0;
  try {
    const narrow: string[] = ["sample"];
    both<string, number | string>(narrow, [])[0] = stored;
    const arrived: string = narrow[0];
    for (let i = 0; i < 3; i++) tally += i;
    note("into a call", Array.of<string | number>(...arrived, tally));
  } catch (error) {
    console.log("into a call", tally, String(error));
  }
}
for (const stored of [1.5, "pq", 1.5]) spreadsIntoACall(stored);
