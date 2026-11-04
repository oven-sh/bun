class Job { get name() { return "a"; } run() { return "ran a"; } }
postMessage(JSON.stringify(new Job(), ["name"]) + " " + new Job().run());
