// Test importing from outside CWD
import { externalModuleFunction } from '/tmp/external-module.js';

function localFunction() {
  externalModuleFunction();
}

localFunction();