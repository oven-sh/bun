const EventEmitter = require('node:events');

class Worker extends EventEmitter {
  constructor(filename) {
    super();
    this.id = Math.random().toString(36).substring(7);
    
    // On notifie Elixir de démarrer le nouveau runtime
    sendToElixir({ type: 'worker_spawn', filename: filename, id: this.id });

    // On prépare la réception des messages
    globalThis.__handle_parent_message = (workerId, data) => {
        if (workerId === this.id) {
            this.emit('message', data);
        }
    };
  }

  postMessage(data) {
    sendToElixir({ type: 'worker_post_message', id: this.id, data: data });
  }

  terminate() {
    // TODO
  }
}

// Objet parentPort pour le code s'exécutant DANS le worker
const parentPort = new EventEmitter();
globalThis.__handle_worker_message = (data) => {
    parentPort.emit('message', data);
};
parentPort.postMessage = (data) => {
    sendToElixir({ type: 'parent_post_message', data: data });
};

module.exports = {
  Worker: Worker,
  parentPort: parentPort,
  isMainThread: !globalThis.__is_worker // TODO: injecter cette globale
};
