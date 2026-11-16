try { process.env.scan(); console.log("called"); } catch (error) { console.log(error.name); }
process.env.scan = "text"; try { process.env.scan(); } catch (error) { console.log(error.name, typeof process.env.scan); }
console.log(typeof process.env.valueOf, process.env.valueOf() === process.env, process.env.propertyIsEnumerable("PATH"));
