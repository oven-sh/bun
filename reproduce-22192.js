// Reproduction case for issue #22192 - Segfault with large arrays
// Based on the wakatime.ts code pattern that causes the crash

console.log("Creating large array to reproduce segfault...");

// Create a large array similar to the heartbeats processing
const createLargeArray = (size) => {
  return Array.from({ length: size }, (_, i) => ({
    id: i,
    timestamp: Date.now() + i,
    file: `/path/to/file${i}.js`,
    type: 'coding',
    category: 'coding',
    project: `project-${i % 100}`,
    branch: `branch-${i % 10}`,
    language: 'javascript',
    dependencies: Array.from({ length: 10 }, (_, j) => `dep-${j}`),
    lines: i * 10,
    lineno: i,
    cursorpos: i * 5,
    is_write: i % 2 === 0
  }));
};

// Function that mimics the heartbeat mapping operation
const mapHeartbeat = (heartbeat, userAgents, userId) => {
  return {
    ...heartbeat,
    userId,
    userAgent: userAgents[heartbeat.id % userAgents.length],
    processed: true,
    hash: `hash-${heartbeat.id}`,
    metadata: {
      original: heartbeat,
      processedAt: new Date().toISOString(),
      extras: Array.from({ length: 20 }, (_, i) => `extra-${i}`)
    }
  };
};

async function reproduce() {
  try {
    // Create test data similar to the original crash
    const userAgents = Array.from({ length: 1000 }, (_, i) => `UserAgent-${i}`);
    const userId = 'test-user-id';
    
    // Start with smaller sizes and work up to find the crash point
    const sizes = [10000, 50000, 100000, 200000, 500000, 1000000];
    
    for (const size of sizes) {
      console.log(`\nTesting with array size: ${size}`);
      
      const heartbeats = createLargeArray(size);
      console.log(`Created array with ${heartbeats.length} items`);
      
      // This mimics the problematic Promise.all + map operation
      console.log('Processing with Promise.all...');
      const startTime = Date.now();
      
      const results = await Promise.all(
        heartbeats.map(async (heartbeat) => {
          const processed = mapHeartbeat(heartbeat, userAgents, userId);
          
          // Add some async work to simulate database operations
          await new Promise(resolve => setImmediate(resolve));
          
          return processed;
        })
      );
      
      const endTime = Date.now();
      console.log(`Processed ${results.length} items in ${endTime - startTime}ms`);
      
      // Force garbage collection if available
      if (global.gc) {
        console.log('Running garbage collection...');
        global.gc();
      }
    }
    
    console.log('\nAll sizes completed successfully');
  } catch (error) {
    console.error('Error during reproduction:', error);
    process.exit(1);
  }
}

reproduce();