import {Router} from "@kapsonfire/bun-bakery"


new Router({
    port: 3000,
    assetsPath: import.meta.dir + '/assets/',
    routesPath: import.meta.dir + '/routes/'
})