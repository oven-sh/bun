// PostMessage worker
let processed = 0;
let numMessages = 0;
let startTime = 0;

onmessage = (e) => {
  if (e.data.type === 'start') {
    numMessages = e.data.numMessages;
    startTime = performance.now();
    processed = 0;
  } else if (e.data.type === 'message') {
    processed++;
    
    if (processed >= numMessages) {
      const endTime = performance.now();
      postMessage({
        type: 'done',
        workerId: e.data.workerId || 0,
        processed,
        duration: endTime - startTime
      });
    }
  }
};