// Test basic alias functionality without cycles
console.log("Testing basic alias functionality...");

try {
  // Test simple alias (non-cyclic)
  const yaml1 = `
shared: &shared_data
  name: shared
  value: 42
    
first:
  data: *shared_data
  
second: 
  data: *shared_data
`;

  const result1 = Bun.YAML.parse(yaml1);
  console.log("Non-cyclic alias test:");
  console.log("- First data name:", result1.first.data.name);
  console.log("- Second data name:", result1.second.data.name);
  console.log("- Are they the same object?", result1.first.data === result1.second.data);
  
  // Test forward reference (non-cyclic)
  const yaml2 = `
first: *forward_ref
second: &forward_ref
  name: forward
  value: 123
`;

  console.log("\nForward reference test:");
  const result2 = Bun.YAML.parse(yaml2);
  console.log("- First name:", result2.first.name);
  console.log("- Second name:", result2.second.name);
  console.log("- Are they the same object?", result2.first === result2.second);

} catch (err) {
  console.log("❌ Error:", err.message);
  console.log("Stack:", err.stack);
}