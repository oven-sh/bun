// An async function takes its options apart in its parameter list, with defaults, and ends in `finally { await resource.close() }`. It returns, throws and is called without options. Built with --aot-validate.
type Options = { retries?: number; label?: string; signal?: { aborted: boolean }; onStep?: (step: string) => void };

class Resource {
  steps: string[] = [];
  isOpen = true;
  constructor(readonly name: string) {}
  async read(fails: boolean): Promise<string> {
    await null;
    this.steps.push("read");
    if (fails) throw new Error("cannot read " + this.name);
    return "text of " + this.name;
  }
  async close(): Promise<void> {
    await null;
    this.isOpen = false;
    this.steps.push("close");
  }
}

async function readAll(name: string, { retries = 1, label = "none", signal, onStep }: Options = {}): Promise<string> {
  const resource = new Resource(name);
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) return label + ": aborted";
      onStep?.("attempt " + attempt);
      try {
        return label + ": " + (await resource.read(attempt < retries));
      } catch (error) {
        if (attempt === retries) throw error;
      }
    }
    return label + ": nothing";
  } finally {
    await resource.close();
    console.log(name, resource.steps.join(), resource.isOpen);
  }
}

const steps: string[] = [];
console.log(await readAll("a"));
console.log(await readAll("b", { retries: 2, label: "twice", onStep: step => steps.push(step) }));
console.log(await readAll("c", { signal: { aborted: true } }));
console.log(await readAll("d", { retries: -1 }));
console.log(await readAll("e", { retries: 0, label: undefined }));
console.log(
  await readAll("f", {
    get retries(): number {
      throw new Error("no retries");
    },
  }).catch(error => "rejected: " + error.message),
);
console.log(steps.join());
