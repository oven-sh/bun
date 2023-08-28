#include "../src/HttpRouter.h"

#include <cassert>
#include <iostream>

void testMethodPriority() {
    std::cout << "TestMethodPriority" << std::endl;
    uWS::HttpRouter<int> r;
    std::string result;

    r.add(r.upperCasedMethods, "/static/route", [&result](auto *) {
        std::cout << "ANY static route" << std::endl;
        result += "AS";
        return true;
    }, r.LOW_PRIORITY);

    r.add({"PATCH"}, "/static/route", [&result](auto *) {
        std::cout << "PATCH static route" << std::endl;
        result += "PS";
        return false;
    });

    r.add({"GET"}, "/static/route", [&result](auto *) {
        std::cout << "GET static route" << std::endl;
        result += "GS";
        return true;
    });

    assert(r.route("nonsense", "/static/route") == false);
    assert(r.route("GET", "/static") == false);
    assert(result == "");

    /* Should end up directly in ANY handler */
    result.clear();
    assert(r.route("POST", "/static/route"));
    assert(result == "AS");

    /* Should up directly in GET handler */
    result.clear();
    assert(r.route("GET", "/static/route"));
    assert(result == "GS");

    /* Should end up in PATCH then in ANY handler */
    result.clear();
    assert(r.route("PATCH", "/static/route"));
    assert(result == "PSAS");
}

void testPatternPriority() {
    std::cout << "TestPatternPriority" << std::endl;
    uWS::HttpRouter<int> r;
    std::string result;

    r.add(r.upperCasedMethods, "/a/b/c", [&result](auto *) {
        std::cout << "ANY static route" << std::endl;
        result += "AS";
        return false;
    }, r.LOW_PRIORITY);

    r.add({"GET"}, "/a/:b/c", [&result](auto *) {
        std::cout << "GET parameter route" << std::endl;
        result += "GP";
        return false;
    });

    r.add({"GET"}, "/a/*", [&result](auto *) {
        std::cout << "GET wildcard route" << std::endl;
        result += "GW";
        return false;
    });

    r.add({"GET"}, "/a/b/c", [&result](auto *) {
        std::cout << "GET static route" << std::endl;
        result += "GS";
        return false;
    });

    r.add({"POST"}, "/a/:b/c", [&result](auto *) {
        std::cout << "POST parameter route" << std::endl;
        result += "PP";
        return false;
    });

    r.add(r.upperCasedMethods, "/a/:b/c", [&result](auto *) {
        std::cout << "ANY parameter route" << std::endl;
        result += "AP";
        return false;
    }, r.LOW_PRIORITY);

    assert(r.route("POST", "/a/b/c") == false);
    assert(result == "ASPPAP");

    result.clear();
    assert(r.route("GET", "/a/b/c") == false);
    assert(result == "GSASGPAPGW");
}

void testUpgrade() {
    std::cout << "TestUpgrade" << std::endl;
    uWS::HttpRouter<int> r;
    std::string result;

    /* HTTP on / */
    r.add({"GET"}, "/something", [&result](auto *) {
        result += "GS";
        return true;
    }, r.MEDIUM_PRIORITY);

    /* HTTP on /* */
    r.add({"GET"}, "/*", [&result](auto *) {
        result += "GW";
        return false;
    }, r.MEDIUM_PRIORITY);

    /* WebSockets on /* */
    r.add({"GET"}, "/*", [&result](auto *) {
        result += "WW";
        return false;
    }, r.HIGH_PRIORITY);

    assert(r.route("GET", "/something"));
    assert(result == "WWGS");
    result.clear();

    assert(r.route("GET", "/") == false);
    assert(result == "WWGW");
}

void testBugReports() {
    std::cout << "TestBugReports" << std::endl;
    {
        uWS::HttpRouter<int> r;
        std::string result;

        r.add({"GET"}, "/foo//////bar/baz/qux", [&result](auto *) {
            result += "MANYSLASH";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.add({"GET"}, "/foo", [&result](auto *) {
            result += "FOO";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.route("GET", "/foo");
        r.route("GET", "/foo/");
        r.route("GET", "/foo//bar/baz/qux");
        r.route("GET", "/foo//////bar/baz/qux");
        assert(result == "FOOMANYSLASH");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        r.add({"GET"}, "/test/*", [&result](auto *) {
            result += "TEST";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.route("GET", "/test/");
        assert(result == "TEST");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        /* WS on /* */
        r.add({"GET"}, "/*", [&result](auto *) {
            result += "WW";
            return false;
        }, r.HIGH_PRIORITY);

        /* HTTP on /ok */
        r.add({"GET"}, "/ok", [&result](auto *) {
            result += "GS";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.add({"GET"}, "/*", [&result](auto *) {
            result += "GW";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.route("GET", "/ok");
        assert(result == "WWGSGW");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        /* WS on / */
        r.add({"GET"}, "/", [&result](auto *) {
            result += "WS";
            return false;
        }, r.HIGH_PRIORITY);

        /* HTTP on / */
        r.add({"GET"}, "/", [&result](auto *) {
            result += "GS";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.route("GET", "/");
        assert(result == "WSGS");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        /* WS on /* */
        r.add({"GET"}, "/*", [&result](auto *) {
            result += "WW";
            return false;
        }, r.HIGH_PRIORITY);

        /* GET on /static */
        r.add({"GET"}, "/static", [&result](auto *) {
            result += "GSL";
            return false;
        }, r.MEDIUM_PRIORITY);

        /* ANY on /* */
        r.add(r.upperCasedMethods, "/*", [&result](auto *) {
            result += "AW";
            return false;
        }, r.LOW_PRIORITY);

        r.route("GET", "/static");
        assert(result == "WWGSLAW");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        /* WS on /* */
        r.add({"GET"}, "/*", [&result](auto *) {
            result += "WW";
            return false;
        }, r.HIGH_PRIORITY);

        /* GET on / */
        r.add({"GET"}, "/", [&result](auto *) {
            result += "GSS";
            return false;
        }, r.MEDIUM_PRIORITY);

        /* GET on /static */
        r.add({"GET"}, "/static", [&result](auto *) {
            result += "GSL";
            return false;
        }, r.MEDIUM_PRIORITY);

        /* ANY on /* */
        r.add(r.upperCasedMethods, "/*", [&result](auto *) {
            result += "AW";
            return false;
        }, r.LOW_PRIORITY);

        r.route("GET", "/static");
        assert(result == "WWGSLAW");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        r.add({"GET"}, "/foo", [&result](auto *) {
            result += "FOO";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.add({"GET"}, "/:id", [&result](auto *) {
            result += "ID";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.add({"GET"}, "/1ab", [&result](auto *) {
            result += "ONEAB";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.route("GET", "/1ab");
        // this one fails with IDONEAB
        std::cout << result << std::endl;
        assert(result == "ONEABID");
    }

    {
        uWS::HttpRouter<int> r;
        std::string result;

        r.add({"GET"}, "/*", [&result](auto *) {
            result += "STAR";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.add({"GET"}, "/", [&result](auto *) {
            result += "STATIC";
            return false;
        }, r.MEDIUM_PRIORITY);

        r.route("GET", "/");
        std::cout << result << std::endl;
        // this one fails with STARSTATIC
        assert(result == "STATICSTAR");
    }

}

void testParameters() {
    std::cout << "TestParameters" << std::endl;
    uWS::HttpRouter<int> r;
    std::string result;

    r.add({"GET"}, "/candy/:kind/*", [&result](auto *h) {
        auto [paramsTop, params] = h->getParameters();

        assert(paramsTop == 0);
        assert(params[0] == "lollipop");

        result += "GPW";
        return false;
    });

    r.add({"GET"}, "/candy/lollipop/*", [&result](auto *h) {
        auto [paramsTop, params] = h->getParameters();

        assert(paramsTop == -1);

        result += "GLW";
        return false;
    });

    r.add({"GET"}, "/candy/:kind/:action", [&result](auto *h) {
        auto [paramsTop, params] = h->getParameters();

        assert(paramsTop == 1);
        assert(params[0] == "lollipop");
        assert(params[1] == "eat");

        result += "GPP";
        return false;
    });

    r.add({"GET"}, "/candy/lollipop/:action", [&result](auto *h) {
        auto [paramsTop, params] = h->getParameters();

        assert(params[0] == "eat");
        assert(paramsTop == 0);

        result += "GLP";
        return false;
    });

    r.add({"GET"}, "/candy/lollipop/eat", [&result](auto *h) {
        auto [paramsTop, params] = h->getParameters();

        assert(paramsTop == -1);

        result += "GLS";
        return false;
    });

    r.route("GET", "/candy/lollipop/eat");
    assert(result == "GLSGLPGLWGPPGPW");
    result.clear();

    r.route("GET", "/candy/lollipop/");
    r.route("GET", "/candy/lollipop");
    r.route("GET", "/candy/");
    assert(result == "GLWGPW");
}

int main() {
    testPatternPriority();
    testMethodPriority();
    testUpgrade();
    testBugReports();
    testParameters();
}
