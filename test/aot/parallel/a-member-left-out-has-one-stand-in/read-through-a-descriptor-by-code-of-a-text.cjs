// The executable leaves the code behind these members out. Code of a text that asks for one twice gets one object.
const text = process.argv.length > 99 ? "0" : `
  const value = name => Object.getOwnPropertyDescriptor(process, name).value;
  return ["finalization", "allowedNodeEnvironmentFlags"].map(name => value(name) === value(name)).join();
`;
console.log(new Function(text)());
