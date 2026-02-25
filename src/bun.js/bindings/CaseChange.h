#pragma once

#include "root.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsFunctionBunCamelCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunPascalCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunSnakeCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunKebabCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunConstantCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunDotCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunCapitalCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunTrainCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunPathCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunSentenceCase);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunNoCase);

}
