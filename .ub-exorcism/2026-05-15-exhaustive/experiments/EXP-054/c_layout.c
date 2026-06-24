#include "node_api.h"
#include <stddef.h>
#include <stdio.h>

int main(void) {
    printf("napi_property_descriptor size=%zu align=%zu "
           "utf8name=%zu name=%zu method=%zu getter=%zu setter=%zu value=%zu attributes=%zu data=%zu\n",
        sizeof(napi_property_descriptor), _Alignof(napi_property_descriptor),
        offsetof(napi_property_descriptor, utf8name),
        offsetof(napi_property_descriptor, name),
        offsetof(napi_property_descriptor, method),
        offsetof(napi_property_descriptor, getter),
        offsetof(napi_property_descriptor, setter),
        offsetof(napi_property_descriptor, value),
        offsetof(napi_property_descriptor, attributes),
        offsetof(napi_property_descriptor, data));

    printf("napi_extended_error_info size=%zu align=%zu "
           "error_message=%zu engine_reserved=%zu engine_error_code=%zu error_code=%zu\n",
        sizeof(napi_extended_error_info), _Alignof(napi_extended_error_info),
        offsetof(napi_extended_error_info, error_message),
        offsetof(napi_extended_error_info, engine_reserved),
        offsetof(napi_extended_error_info, engine_error_code),
        offsetof(napi_extended_error_info, error_code));

    printf("napi_type_tag size=%zu align=%zu lower=%zu upper=%zu\n",
        sizeof(napi_type_tag), _Alignof(napi_type_tag),
        offsetof(napi_type_tag, lower),
        offsetof(napi_type_tag, upper));

    printf("napi_node_version size=%zu align=%zu major=%zu minor=%zu patch=%zu release=%zu\n",
        sizeof(napi_node_version), _Alignof(napi_node_version),
        offsetof(napi_node_version, major),
        offsetof(napi_node_version, minor),
        offsetof(napi_node_version, patch),
        offsetof(napi_node_version, release));

    printf("napi_module size=%zu align=%zu "
           "nm_version=%zu nm_flags=%zu nm_filename=%zu nm_register_func=%zu nm_modname=%zu nm_priv=%zu reserved=%zu\n",
        sizeof(napi_module), _Alignof(napi_module),
        offsetof(napi_module, nm_version),
        offsetof(napi_module, nm_flags),
        offsetof(napi_module, nm_filename),
        offsetof(napi_module, nm_register_func),
        offsetof(napi_module, nm_modname),
        offsetof(napi_module, nm_priv),
        offsetof(napi_module, reserved));

    return 0;
}
