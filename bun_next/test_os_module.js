// Test du module node:os
// Comme on n'a pas encore le loader complet pour node_source, 
// on utilise internalBinding directement pour valider les bindings.

const osBinding = internalBinding('os');

console.log('--- Test OS Binding ---');
console.log('Hostname:', osBinding.getHostname());
console.log('Free Memory (KB):', osBinding.getFreeMem());
console.log('Total Memory (KB):', osBinding.getTotalMem());

if (osBinding.getTotalMem() > 0) {
    sendToElixir({ type: 'os_test_result', status: 'success', data: {
        hostname: osBinding.getHostname(),
        totalMem: osBinding.getTotalMem()
    }});
} else {
    sendToElixir({ type: 'os_test_result', status: 'fail' });
}
