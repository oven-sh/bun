class Job { get name() { return "b"; } run() { return "ran b"; } }
postMessage(JSON.stringify(new Job(), ["name"]) + " " + new Job().run());
