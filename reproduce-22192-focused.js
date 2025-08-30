// More focused reproduction to identify the exact crash point

console.log("Focused reproduction for #22192");

const createHeartbeat = (id) => ({
  id,
  timestamp: Date.now() + id,
  file: `/path/to/file${id}.js`,
  type: 'coding',
  category: 'coding',
  project: `project-${id % 100}`,
  branch: `branch-${id % 10}`,
  language: 'javascript',
  dependencies: Array.from({ length: 10 }, (_, j) => `dep-${j}`),
  lines: id * 10,
  lineno: id,
  cursorpos: id * 5,
  is_write: id % 2 === 0
});

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

async function testSize(size) {
  console.log(`\n=== Testing size: ${size} ===`);
  
  const userAgents = Array.from({ length: 1000 }, (_, i) => `UserAgent-${i}`);
  const userId = 'test-user-id';
  
  console.log(`Creating ${size} heartbeats...`);
  const heartbeats = Array.from({ length: size }, (_, i) => createHeartbeat(i));
  
  console.log(`Processing ${size} heartbeats with Promise.all...`);
  const start = Date.now();
  
  try {
    const results = await Promise.all(
      heartbeats.map(async (heartbeat) => {
        const processed = mapHeartbeat(heartbeat, userAgents, userId);
        
        // Add minimal async work
        await new Promise(resolve => setImmediate(resolve));
        
        return processed;
      })
    );
    
    const duration = Date.now() - start;
    console.log(`✓ Successfully processed ${results.length} items in ${duration}ms`);
    console.log(`Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    
    return true;
  } catch (error) {
    console.error(`✗ Failed at size ${size}:`, error.message);
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 10).join('\n'));
    }
    return false;
  }
}

async function main() {
  // Test progressively larger sizes
  const sizes = [1000, 5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000];
  
  for (const size of sizes) {
    const success = await testSize(size);
    
    if (!success) {
      console.log(`\nCrash reproduced at size: ${size}`);
      process.exit(1);
    }
    
    // Force GC between tests
    if (global.gc) {
      global.gc();
    }
    
    // Add delay to let system recover
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\nAll sizes completed successfully - no crash reproduced');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});