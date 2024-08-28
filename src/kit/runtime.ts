/**
 * All modules for the initial bundle.
 * The first one is the entrypoint.
 */
declare const graph: ModuleLoad[];
/**
 * The runtime is bundled for server and client, which influences
 * how hmr connection should be established, as well if there is
 * a window to visually display errors with.
*/
declare const mode: 'client' | 'server';

if (typeof IS_BUN_DEVELOPMENT !== 'boolean') { throw new Error('DCE is configured incorrectly') }

type RequireFunction = (id: number) => void;
type ModuleLoad = (require: RequireFunction, ctx: Hmr) => void;

interface Hmr {

}

console.log(graph, 'mode: ' + mode);

export {}
