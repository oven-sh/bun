/*
 * NOTE: THIS IS A TEMPORARY FALLBACK!!!!!
 * 
 * To support basic lookup, it uses DoH with CloudFlare's endpoint 1.1.1.1
 */
import { callbackify } from 'util';

import * as consts from './dns_constants';

export class ResolverAsync {
  cancel() { throw new Error(`unimplemented cancel`); }
  getServers() { throw new Error(`unimplemented getServers`); }
  async resolve() { throw new Error(`unimplemented resolve`); }
  async resolve4() { throw new Error(`unimplemented resolve4`); }
  async resolve6() { throw new Error(`unimplemented resolve6`); }
  async resolveAny() { throw new Error(`unimplemented resolveAny`); }
  async resolveCaa() { throw new Error(`unimplemented resolveCaa`); }
  async resolveCname() { throw new Error(`unimplemented resolveCname`); }
  async resolveMx() { throw new Error(`unimplemented resolveMx`); }
  async resolveNaptr() { throw new Error(`unimplemented resolveNaptr`); }
  async resolveNs() { throw new Error(`unimplemented resolveNs`); }
  async resolvePtr() { throw new Error(`unimplemented resolvePtr`); }
  async resolveSoa() { throw new Error(`unimplemented resolveSoa`); }
  async resolveSrv() { throw new Error(`unimplemented resolveSrv`); }
  async resolveTxt() { throw new Error(`unimplemented resolveTxt`); }
  async reverse() { throw new Error(`unimplemented reverse`); }
  setLocalAddress(ipv4 = '0.0.0.0', ipv6 = '::0') { throw new Error(`unimplemented setLocalAddress`); }
  setServers() { throw new Error(`unimplemented setServers`); }
};

const global_async = new ResolverAsync();

const lookup_async = async(hostname, opts) => {
  const f = await fetch(`https://1.1.1.1/dns-query?name=${hostname}`, {headers: new Headers({'accept': 'application/dns-json'})});
  const res = await f.json();
  const Answer = res.Answer;
  return (opts?.all) ? Answer.map(r => r.data) : Answer[0].data;
};

const lookupService_async = () => { throw new Error(`unimplemented lookupService`); };
const setDefaultResultOrder_async = () => { throw new Error(`unimplemented setDefaultResultOrder`); };

export const promises = {
  ...consts,
  lookup: lookup_async,
  lookupService: lookupService_async,
  setDefaultResultOrder: setDefaultResultOrder_async,
  getServers: global_async.getServers.bind(global_async),
  resolve: global_async.resolve.bind(global_async),
  resolve4: global_async.resolve4.bind(global_async),
  resolve6: global_async.resolve6.bind(global_async),
  resolveAny: global_async.resolveAny.bind(global_async),
  resolveCaa: global_async.resolveCaa.bind(global_async),
  resolveCname: global_async.resolveCname.bind(global_async),
  resolveMx: global_async.resolveMx.bind(global_async),
  resolveNaptr: global_async.resolveNaptr.bind(global_async),
  resolveNs: global_async.resolveNs.bind(global_async),
  resolvePtr: global_async.resolvePtr.bind(global_async),
  resolveSoa: global_async.resolveSoa.bind(global_async),
  resolveSrv: global_async.resolveSrv.bind(global_async),
  resolveTxt: global_async.resolveTxt.bind(global_async),
  reverse: global_async.reverse.bind(global_async),
  setServers: global_async.setServers.bind(global_async),
  Resolver: ResolverAsync,
};

export * from './dns_constants';

export class ResolverCB {
  cancel() { throw new Error(`unimplemented cancel`); }
  getServers() { throw new Error(`unimplemented getServers`); }
  async resolve() { throw new Error(`unimplemented resolve`); }
  async resolve4() { throw new Error(`unimplemented resolve4`); }
  async resolve6() { throw new Error(`unimplemented resolve6`); }
  async resolveAny() { throw new Error(`unimplemented resolveAny`); }
  async resolveCaa() { throw new Error(`unimplemented resolveCaa`); }
  async resolveCname() { throw new Error(`unimplemented resolveCname`); }
  async resolveMx() { throw new Error(`unimplemented resolveMx`); }
  async resolveNaptr() { throw new Error(`unimplemented resolveNaptr`); }
  async resolveNs() { throw new Error(`unimplemented resolveNs`); }
  async resolvePtr() { throw new Error(`unimplemented resolvePtr`); }
  async resolveSoa() { throw new Error(`unimplemented resolveSoa`); }
  async resolveSrv() { throw new Error(`unimplemented resolveSrv`); }
  async resolveTxt() { throw new Error(`unimplemented resolveTxt`); }
  async reverse() { throw new Error(`unimplemented reverse`); }
  setLocalAddress(ipv4 = '0.0.0.0', ipv6 = '::0') { throw new Error(`unimplemented setLocalAddress`); }
  setServers() { throw new Error(`unimplemented setServers`); }
};

const global_cb = new ResolverCB();

export const getServers = global_cb.getServers.bind(global_cb);
export const resolve = global_cb.resolve.bind(global_cb);
export const resolve4 = global_cb.resolve4.bind(global_cb);
export const resolve6 = global_cb.resolve6.bind(global_cb);
export const resolveAny = global_cb.resolveAny.bind(global_cb);
export const resolveCaa = global_cb.resolveCaa.bind(global_cb);
export const resolveCname = global_cb.resolveCname.bind(global_cb);
export const resolveMx = global_cb.resolveMx.bind(global_cb);
export const resolveNaptr = global_cb.resolveNaptr.bind(global_cb);
export const resolveNs = global_cb.resolveNs.bind(global_cb);
export const resolvePtr = global_cb.resolvePtr.bind(global_cb);
export const resolveSoa = global_cb.resolveSoa.bind(global_cb);
export const resolveSrv = global_cb.resolveSrv.bind(global_cb);
export const resolveTxt = global_cb.resolveTxt.bind(global_cb);
export const reverse = global_cb.reverse.bind(global_cb);
export const setServers = global_cb.setServers.bind(global_cb);

export const lookup = callbackify(lookup_async);
export const lookupService = callbackify(lookupService_async);
export const setDefaultResultOrder = callbackify(setDefaultResultOrder_async);
