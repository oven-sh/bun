#include "root.h"

#if OS(LINUX) || OS(FREEBSD)

#include "Secrets.h"
#include <dlfcn.h>
#include <wtf/text/WTFString.h>
#include <wtf/NeverDestroyed.h>

namespace Bun {
namespace Secrets {

using namespace WTF;

// Minimal GLib type definitions to avoid linking against GLib
typedef struct _GError GError;
typedef struct _SecretSchema SecretSchema;

typedef int gboolean;
typedef char gchar;
typedef void* gpointer;
typedef unsigned int guint;
typedef int gint;

// GLib constants
#define G_FALSE 0
#define G_TRUE 1

// Secret schema types
typedef enum {
    SECRET_SCHEMA_NONE = 0,
    SECRET_SCHEMA_DONT_MATCH_NAME = 1 << 1
} SecretSchemaFlags;

typedef enum {
    SECRET_SCHEMA_ATTRIBUTE_STRING = 0,
    SECRET_SCHEMA_ATTRIBUTE_INTEGER = 1,
    SECRET_SCHEMA_ATTRIBUTE_BOOLEAN = 2
} SecretSchemaAttributeType;

typedef struct {
    const gchar* name;
    SecretSchemaAttributeType type;
} SecretSchemaAttribute;

struct _SecretSchema {
    const gchar* name;
    SecretSchemaFlags flags;
    SecretSchemaAttribute attributes[32];

    /* <private> */
    gint reserved;
    gpointer reserved1;
    gpointer reserved2;
    gpointer reserved3;
    gpointer reserved4;
    gpointer reserved5;
    gpointer reserved6;
    gpointer reserved7;
};

struct _GError {
    guint domain;
    int code;
    gchar* message;
};

class LibsecretFramework {
public:
    void* secret_handle;
    void* glib_handle;
    void* gobject_handle;

    // GLib function pointers
    void (*g_error_free)(GError* error);

    // libsecret function pointers
    gboolean (*secret_password_store_sync)(const SecretSchema* schema,
        const gchar* collection,
        const gchar* label,
        const gchar* password,
        void* cancellable,
        GError** error,
        ...);

    gchar* (*secret_password_lookup_sync)(const SecretSchema* schema,
        void* cancellable,
        GError** error,
        ...);

    gboolean (*secret_password_clear_sync)(const SecretSchema* schema,
        void* cancellable,
        GError** error,
        ...);

    void (*secret_password_free)(gchar* password);

    LibsecretFramework()
        : secret_handle(nullptr)
        , glib_handle(nullptr)
        , gobject_handle(nullptr)
    {
    }

    bool load()
    {
        if (secret_handle && glib_handle && gobject_handle) return true;

        // Load GLib
        glib_handle = dlopen("libglib-2.0.so.0", RTLD_LAZY | RTLD_GLOBAL);
        if (!glib_handle) {
            // Try alternative name
            glib_handle = dlopen("libglib-2.0.so", RTLD_LAZY | RTLD_GLOBAL);
            if (!glib_handle) return false;
        }

        // Load GObject (needed for some GLib types)
        gobject_handle = dlopen("libgobject-2.0.so.0", RTLD_LAZY | RTLD_GLOBAL);
        if (!gobject_handle) {
            gobject_handle = dlopen("libgobject-2.0.so", RTLD_LAZY | RTLD_GLOBAL);
            if (!gobject_handle) {
                dlclose(glib_handle);
                glib_handle = nullptr;
                return false;
            }
        }

        // Load libsecret
        secret_handle = dlopen("libsecret-1.so.0", RTLD_LAZY | RTLD_LOCAL);
        if (!secret_handle) {
            dlclose(glib_handle);
            dlclose(gobject_handle);
            glib_handle = nullptr;
            gobject_handle = nullptr;
            return false;
        }

        if (!load_functions()) {
            dlclose(secret_handle);
            dlclose(glib_handle);
            dlclose(gobject_handle);
            secret_handle = nullptr;
            glib_handle = nullptr;
            gobject_handle = nullptr;
            return false;
        }

        return true;
    }

private:
    bool load_functions()
    {
        // Load GLib functions
        g_error_free = (void (*)(GError*))dlsym(glib_handle, "g_error_free");

        // Load libsecret functions
        secret_password_store_sync = (gboolean (*)(const SecretSchema*, const gchar*, const gchar*, const gchar*, void*, GError**, ...))
            dlsym(secret_handle, "secret_password_store_sync");
        secret_password_lookup_sync = (gchar * (*)(const SecretSchema*, void*, GError**, ...))
            dlsym(secret_handle, "secret_password_lookup_sync");
        secret_password_clear_sync = (gboolean (*)(const SecretSchema*, void*, GError**, ...))
            dlsym(secret_handle, "secret_password_clear_sync");
        secret_password_free = (void (*)(gchar*))dlsym(secret_handle, "secret_password_free");

        return g_error_free && secret_password_store_sync && secret_password_lookup_sync && secret_password_clear_sync && secret_password_free;
    }
};

static LibsecretFramework* libsecretFramework()
{
    static LazyNeverDestroyed<LibsecretFramework> framework;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        framework.construct();
        if (!framework->load()) {
            // Framework failed to load, but object is still constructed
        }
    });
    return framework->secret_handle ? &framework.get() : nullptr;
}

// Define our simple schema for Bun secrets
static const SecretSchema* get_bun_schema()
{
    static const SecretSchema schema = {
        "com.oven-sh.bun.Secret",
        SECRET_SCHEMA_NONE,
        { { "service", SECRET_SCHEMA_ATTRIBUTE_STRING },
            { "account", SECRET_SCHEMA_ATTRIBUTE_STRING },
            { nullptr, (SecretSchemaAttributeType)0 } }
    };
    return &schema;
}

static void updateError(Error& err, GError* gerror)
{
    if (!gerror) {
        err = Error {};
        return;
    }

    err.message = String::fromUTF8(gerror->message);
    err.code = gerror->code;
    err.type = ErrorType::PlatformError;

    auto* framework = libsecretFramework();
    if (framework) {
        framework->g_error_free(gerror);
    }
}

Error setPassword(const CString& service, const CString& name, CString&& password, bool allowUnrestrictedAccess)
{
    Error err;

    auto* framework = libsecretFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "libsecret not available"_s;
        return err;
    }

    // Empty string means delete - call deletePassword instead
    if (password.length() == 0) {
        deletePassword(service, name, err);
        // Convert delete result to setPassword semantics
        // Delete errors (like NotFound) should not be propagated for empty string sets
        if (err.type == ErrorType::NotFound) {
            err = Error {}; // Clear the error - deleting non-existent is not an error for set("")
        }
        return err;
    }

    GError* gerror = nullptr;
    // Combine service and name for label
    auto label = makeString(String::fromUTF8(service.data()), "/"_s, String::fromUTF8(name.data()));
    auto labelUtf8 = label.utf8();

    gboolean result = framework->secret_password_store_sync(
        get_bun_schema(),
        nullptr, // Let libsecret handle collection creation automatically
        labelUtf8.data(),
        password.data(),
        nullptr, // cancellable
        &gerror,
        "service", service.data(),
        "account", name.data(),
        nullptr // end of attributes
    );

    if (!result || gerror) {
        updateError(err, gerror);
        if (err.message.isEmpty()) {
            err.type = ErrorType::PlatformError;
            err.message = "Failed to store password"_s;
        }
    }

    return err;
}

std::optional<WTF::Vector<uint8_t>> getPassword(const CString& service, const CString& name, Error& err)
{
    err = Error {};

    auto* framework = libsecretFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "libsecret not available"_s;
        return std::nullopt;
    }

    GError* gerror = nullptr;

    gchar* raw_password = framework->secret_password_lookup_sync(
        get_bun_schema(),
        nullptr, // cancellable
        &gerror,
        "service", service.data(),
        "account", name.data(),
        nullptr // end of attributes
    );

    if (gerror) {
        updateError(err, gerror);
        return std::nullopt;
    }

    if (!raw_password) {
        err.type = ErrorType::NotFound;
        return std::nullopt;
    }

    // Convert to Vector for thread safety
    size_t length = strlen(raw_password);
    WTF::Vector<uint8_t> result;
    result.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(raw_password), length));

    // Clear the password before freeing
    memset(raw_password, 0, length);
    framework->secret_password_free(raw_password);

    return result;
}

bool deletePassword(const CString& service, const CString& name, Error& err)
{
    err = Error {};

    auto* framework = libsecretFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "libsecret not available"_s;
        return false;
    }

    GError* gerror = nullptr;

    gboolean result = framework->secret_password_clear_sync(
        get_bun_schema(),
        nullptr, // cancellable
        &gerror,
        "service", service.data(),
        "account", name.data(),
        nullptr // end of attributes
    );

    if (gerror) {
        updateError(err, gerror);
        return false;
    }

    // libsecret returns TRUE if items were deleted, FALSE if no items found
    if (!result) {
        err.type = ErrorType::NotFound;
        return false;
    }

    return true;
}

} // namespace Secrets
} // namespace Bun

#endif // OS(LINUX) || OS(FREEBSD)
