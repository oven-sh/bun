import * as all from "./main.mjs";
import standard, { Kind, call, changing, count, fixed, record, text } from "./main.mjs";

function say(where, name, error) {
  console.log(where, name, error.name, error.name === "ReferenceError" ? error.message : "");
}

try {
  console.log("top", "text", typeof text, text.length);
} catch (error) {
  say("top", "text", error);
}
try {
  console.log("top", "count", typeof count, count + 1);
} catch (error) {
  say("top", "count", error);
}
try {
  console.log("top", "record", typeof record, record.x);
} catch (error) {
  say("top", "record", error);
}
try {
  console.log("top", "changing", typeof changing, changing.length);
} catch (error) {
  say("top", "changing", error);
}
try {
  console.log("top", "fixed", typeof fixed, fixed.y);
} catch (error) {
  say("top", "fixed", error);
}
try {
  console.log("top", "Kind", typeof Kind, Kind.z);
} catch (error) {
  say("top", "Kind", error);
}
try {
  console.log("top", "call", typeof call, call());
} catch (error) {
  say("top", "call", error);
}
try {
  console.log("top", "standard", typeof standard, standard.length);
} catch (error) {
  say("top", "standard", error);
}
try {
  console.log("top", "all.text", typeof all.text, all.text.length);
} catch (error) {
  say("top", "all.text", error);
}
try {
  console.log("top", "all.fixed", typeof all.fixed, all.fixed.y);
} catch (error) {
  say("top", "all.fixed", error);
}

function look(where) {
  try {
    console.log(where, "text", typeof text, text.length);
  } catch (error) {
    say(where, "text", error);
  }
  try {
    console.log(where, "count", typeof count, count + 1);
  } catch (error) {
    say(where, "count", error);
  }
  try {
    console.log(where, "record", typeof record, record.x);
  } catch (error) {
    say(where, "record", error);
  }
  try {
    console.log(where, "changing", typeof changing, changing.length);
  } catch (error) {
    say(where, "changing", error);
  }
  try {
    console.log(where, "fixed", typeof fixed, fixed.y);
  } catch (error) {
    say(where, "fixed", error);
  }
  try {
    console.log(where, "Kind", typeof Kind, Kind.z);
  } catch (error) {
    say(where, "Kind", error);
  }
  try {
    console.log(where, "call", typeof call, call());
  } catch (error) {
    say(where, "call", error);
  }
  try {
    console.log(where, "standard", typeof standard, standard.length);
  } catch (error) {
    say(where, "standard", error);
  }
  try {
    console.log(where, "all.text", typeof all.text, all.text.length);
  } catch (error) {
    say(where, "all.text", error);
  }
  try {
    console.log(where, "all.fixed", typeof all.fixed, all.fixed.y);
  } catch (error) {
    say(where, "all.fixed", error);
  }
}
look("function");
Promise.resolve().then(() => look("job"));
setTimeout(() => look("timer"), 0);
