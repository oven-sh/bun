// A class inside a function that runs once fills a static field at its first read, and a method of another class reads it in a loop under a handler.
let reads = 0;
function readLimit() {
  reads++;
  return 8;
}
const failing = () => {
  reads++;
  throw new Error("unread");
};

function accessor() {
  class Settings {
    static limit = undefined;
    static get max() {
      return (this.limit ??= readLimit());
    }
  }
  class Job {
    cost() {
      return Settings.max + 1;
    }
  }
  for (let turn = 0; turn < 3; turn++) {
    try {
      console.log("accessor", new Job().cost(), reads);
    } catch (error) {
      console.log("accessor", error.message);
    }
  }
}

function branch() {
  class Settings {
    static limit = undefined;
    static get max() {
      if (this.limit === undefined) this.limit = readLimit();
      return this.limit;
    }
  }
  class Job {
    cost() {
      return Settings.max + 1;
    }
  }
  for (let turn = 0; turn < 3; turn++) {
    try {
      console.log("branch", new Job().cost(), reads);
    } catch (error) {
      console.log("branch", error.message);
    }
  }
}

function method() {
  class Settings {
    static limit = 0;
    static max() {
      return (this.limit ||= readLimit());
    }
  }
  class Job {
    cost() {
      return Settings.max() + 1;
    }
  }
  for (let turn = 0; turn < 3; turn++) {
    try {
      console.log("method", new Job().cost(), reads);
    } finally {
      reads += 10;
    }
  }
}

function helper() {
  class Settings {
    static limit = undefined;
    static get max() {
      return (this.limit ??= readLimit());
    }
  }
  class Job {
    cost() {
      return Settings.max + 1;
    }
  }
  const times = f => {
    for (let turn = 0; turn < 3; turn++) {
      try {
        f();
      } catch (error) {
        console.log("helper", error.message);
      }
    }
  };
  times(() => console.log("helper", new Job().cost(), reads));
}

function instance() {
  class Settings {
    limit = undefined;
    get max() {
      return (this.limit ??= readLimit());
    }
  }
  const settings = new Settings();
  class Job {
    cost() {
      return settings.max + 1;
    }
  }
  for (let turn = 0; turn < 3; turn++) {
    try {
      console.log("instance", new Job().cost(), reads);
      if (turn === 1) settings.limit = null;
    } catch (error) {
      console.log("instance", error.message);
    }
  }
}

function privateName() {
  const Settings = class {
    static #limit;
    static get max() {
      return (this.#limit ??= readLimit());
    }
    static forget() {
      this.#limit = undefined;
    }
  };
  class Job {
    cost() {
      return Settings.max + 1;
    }
  }
  for (let turn = 0; turn < 4; turn++) {
    try {
      console.log("private", new Job().cost(), reads);
      if (turn === 2) Settings.forget();
    } catch (error) {
      console.log("private", error.message);
    }
  }
}

function throwing() {
  class Settings {
    static limit = undefined;
    static get max() {
      return (this.limit ??= reads % 4 ? failing() : readLimit());
    }
  }
  class Job {
    cost() {
      return Settings.max + 1;
    }
  }
  for (let turn = 0; turn < 6; turn++) {
    try {
      console.log("throwing", new Job().cost(), reads);
    } catch (error) {
      console.log("throwing", error.message, reads);
    }
  }
}

function afterCalls() {
  class Settings {
    static count = 1;
    static get next() {
      return (this.count &&= this.count + readLimit());
    }
  }
  class Job {
    cost() {
      return Settings.next;
    }
  }
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) {
    try {
      sum += new Job().cost();
      if (sum > 5000) Settings.count = 0;
    } catch (error) {
      console.log("after", error.message);
    }
  }
  console.log("after", sum, Settings.count);
}

accessor();
branch();
method();
helper();
instance();
privateName();
throwing();
afterCalls();
