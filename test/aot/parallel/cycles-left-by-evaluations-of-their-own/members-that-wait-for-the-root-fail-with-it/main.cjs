const errors = [];
const note = (name, error) => { errors.push(error); console.log(name, error.message, error === errors[0]); };
try { console.log("first", require("./first.mjs").ok); } catch (error) { note("first", error); }
try { console.log("middle", require("./middle.mjs").ok); } catch (error) { note("middle", error); }
try { console.log("last", require("./last.mjs").ok); } catch (error) { note("last", error); }
try { console.log("first", require("./first.mjs").ok); } catch (error) { note("first", error); }
try { console.log("last", require("./last.mjs").ok); } catch (error) { note("last", error); }
console.log(errors.length);
