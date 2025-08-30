// Simpler reproduction case focusing on potential call stack exhaustion
// The WASM trampoline crash suggests recursive calls hitting limits

console.log("Testing for call stack exhaustion...");

// Test 1: Deep recursion in Promise.all
async function testDeepPromiseRecursion() {
  console.log("\n=== Test 1: Deep Promise recursion ===");
  
  const createNestedPromise = (depth) => {
    if (depth === 0) {
      return Promise.resolve(1);
    }
    return Promise.resolve().then(() => createNestedPromise(depth - 1));
  };
  
  try {
    // Test with increasing depths
    for (const depth of [1000, 5000, 10000, 20000, 50000]) {
      console.log(`Testing depth: ${depth}`);
      const start = Date.now();
      await createNestedPromise(depth);
      console.log(`Depth ${depth} completed in ${Date.now() - start}ms`);
    }
  } catch (error) {
    console.error("Caught error in deep recursion:", error.message);
  }
}

// Test 2: Large Promise.all with nested operations
async function testLargePromiseAll() {
  console.log("\n=== Test 2: Large Promise.all with nested operations ===");
  
  const processItem = async (item, depth = 0) => {
    if (depth > 100) return item; // Prevent infinite recursion
    
    // Simulate nested async operations
    await Promise.resolve();
    
    if (item % 1000 === 0) {
      return processItem(item + 1, depth + 1);
    }
    
    return { 
      value: item, 
      processed: true,
      nested: Array.from({ length: 10 }, (_, i) => ({ id: i, data: `data-${i}` }))
    };
  };
  
  try {
    for (const size of [10000, 50000, 100000]) {
      console.log(`Testing Promise.all with ${size} items`);
      const start = Date.now();
      
      const items = Array.from({ length: size }, (_, i) => i);
      const results = await Promise.all(items.map(item => processItem(item)));
      
      console.log(`Processed ${results.length} items in ${Date.now() - start}ms`);
      
      // Force GC if available
      if (global.gc) {
        global.gc();
      }
    }
  } catch (error) {
    console.error("Caught error in Promise.all:", error.message);
  }
}

// Test 3: Simulate the original wakatime pattern
async function testWakatimePattern() {
  console.log("\n=== Test 3: Wakatime-like pattern ===");
  
  const createHeartbeat = (id) => ({
    id,
    timestamp: Date.now(),
    file: `/path/file${id}.js`,
    project: `project-${id % 100}`,
    dependencies: Array.from({ length: 20 }, (_, i) => `dep-${i}`),
    metadata: {
      lines: id * 10,
      chars: id * 100,
      nested: {
        deep: {
          object: {
            with: {
              many: {
                levels: `level-${id}`
              }
            }
          }
        }
      }
    }
  });
  
  const mapHeartbeat = (heartbeat, userAgents, userId) => {
    return {
      ...heartbeat,
      userId,
      userAgent: userAgents[heartbeat.id % userAgents.length],
      processed: new Date().toISOString(),
      // Create deeply nested object
      processingInfo: {
        stage1: { data: heartbeat },
        stage2: { transformed: { ...heartbeat, extra: "data" } },
        stage3: { final: { result: true, heartbeat } }
      }
    };
  };
  
  try {
    const userAgents = Array.from({ length: 1000 }, (_, i) => `Agent-${i}`);
    const userId = "test-user";
    
    for (const size of [50000, 100000, 200000]) {
      console.log(`Testing wakatime pattern with ${size} heartbeats`);
      const start = Date.now();
      
      const heartbeats = Array.from({ length: size }, (_, i) => createHeartbeat(i));
      
      // This is the pattern that seems to cause issues
      const results = await Promise.all(
        heartbeats.map(async (heartbeat) => {
          const mapped = mapHeartbeat(heartbeat, userAgents, userId);
          
          // Simulate async database operation
          await new Promise(resolve => setImmediate(resolve));
          
          return mapped;
        })
      );
      
      console.log(`Processed ${results.length} heartbeats in ${Date.now() - start}ms`);
      console.log(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
      
      if (global.gc) {
        console.log("Running garbage collection...");
        global.gc();
        console.log(`Memory after GC: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
      }
    }
  } catch (error) {
    console.error("Caught error in wakatime pattern:", error.message);
    console.error("Stack trace:", error.stack);
  }
}

async function runAllTests() {
  try {
    await testDeepPromiseRecursion();
    await testLargePromiseAll(); 
    await testWakatimePattern();
    console.log("\nAll tests completed successfully");
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

runAllTests();