// ProcessStorage + Atomics worker
const storage = Bun.experimental_processStorage;

onmessage = (e) => {
  if (e.data.type === 'start') {
    const { workerId, numMessages, sharedBuffer } = e.data;
    const counters = new Int32Array(sharedBuffer);
    
    let processed = 0;
    const startTime = performance.now();
    
    // Read messages from storage
    for (let i = 0; i < numMessages; i++) {
      const data = storage.getItem(`msg_${i}`);
      if (data) {
        processed++;
        Atomics.add(counters, workerId, 1);
      }
    }
    
    const endTime = performance.now();
    
    postMessage({
      type: 'done',
      workerId,
      processed,
      duration: endTime - startTime
    });
  }
};