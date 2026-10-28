import { Kind, count, fixed, record, text } from "./all.ts";

function say(where: string, name: string, error: any) {
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
  console.log("top", "fixed", typeof fixed, fixed.y);
} catch (error) {
  say("top", "fixed", error);
}
try {
  console.log("top", "Kind", typeof Kind, Kind.z);
} catch (error) {
  say("top", "Kind", error);
}

function look(where: string) {
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
    console.log(where, "fixed", typeof fixed, fixed.y);
  } catch (error) {
    say(where, "fixed", error);
  }
  try {
    console.log(where, "Kind", typeof Kind, Kind.z);
  } catch (error) {
    say(where, "Kind", error);
  }
}
look("function");
Promise.resolve().then(() => look("job"));
setTimeout(() => look("timer"), 0);
